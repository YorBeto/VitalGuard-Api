import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Prefijo para las claves del bucket (identifica por tipo de endpoint). */
  name: string;
}

interface Bucket {
  hits: number[];
}

/**
 * Guard de rate limiting propio, en memoria, limitado por `vital_id`.
 *
 * - Para rutas protegidas por JWT usa `request.user.vitalId` (ya resuelto).
 * - Para `POST /alexa` (token en el body) decodifica el JWT sin validar firma
 *   para extraer `sub` como clave — suficiente para contar límites sin acoplar.
 * - Si no hay vital_id identificable, usa la IP del cliente como fallback.
 *
 * Auto-contenido (no depende de DI de @nestjs/jwt): se instancia con
 * `new RateLimitGuard(opts)` y se expone como provider en el módulo.
 *
 * Nota: memoria del proceso (ok para despliegue single-instance). Para
 * multi-instancia migrar a un store compartido (Redis).
 */
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: RateLimitOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = this.resolveKey(req);

    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (bucket) {
      // Elimina hits fuera de la ventana
      bucket.hits = bucket.hits.filter(
        (t) => now - t < this.options.windowMs,
      );

      if (bucket.hits.length >= this.options.limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Demasiadas peticiones. Inténtalo de nuevo en un momento.',
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      bucket.hits.push(now);
    } else {
      this.buckets.set(key, { hits: [now] });
    }

    return true;
  }

  private resolveKey(req: any): string {
    // 1. rutas protegidas por JWT
    if (req.user?.vitalId) {
      return `${this.options.name}:vital:${req.user.vitalId}`;
    }

    // 2. POST /alexa → token en JSON body (context.System.user.accessToken)
    const token =
      req.body?.context?.System?.user?.accessToken || req.body?.accessToken;
    if (token) {
      try {
        const payload = jwt.decode(token) as { sub?: string } | null;
        if (payload?.sub) {
          return `${this.options.name}:vital:${payload.sub}`;
        }
      } catch {
        // token no decodificable → cae al fallback por IP
      }
    }

    // 3. fallback por IP
    return `${this.options.name}:ip:${req.ip ?? 'unknown'}`;
  }
}

/** Lee y valida una opción de rate limit desde variables de entorno. */
export function rateLimitFromEnv(
  name: string,
  defaults: { limit: number; windowMs: number },
): RateLimitOptions {
  const num = (v?: string, fallback?: number) => {
    const n = Number(v ?? '');
    return Number.isFinite(n) && n > 0 ? n : fallback!;
  };

  return {
    name,
    limit: num(
      process.env[`RATE_LIMIT_${name.toUpperCase()}_LIMIT`],
      defaults.limit,
    ),
    windowMs: num(
      process.env[`RATE_LIMIT_${name.toUpperCase()}_WINDOW_MS`],
      defaults.windowMs,
    ),
  };
}
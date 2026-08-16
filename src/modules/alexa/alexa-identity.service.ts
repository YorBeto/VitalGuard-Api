import { Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Identidad OAuth — resuelve el accessToken de Alexa contra Vital ID.
 *
 * VitalGuard recibe el `accessToken` que Alexa envía en cada petición y lo
 * valida contra el Authorization Server (Vital ID) mediante
 * `GET /oauth/userinfo`. El resultado es el `vital_id` (UUID) que identifica
 * al usuario en VitalGuard.
 *
 * Caso B8: si Vital ID responde 401/403 (token expirado/revocado/desvinculado),
 * se lanza UnauthorizedException para que la skill responda "reconecta tu cuenta".
 */
@Injectable()
export class AlexaIdentityService {
  private get baseUrl(): string {
    const base = (process.env.VITAL_ID_BASE_URL || '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('VITAL_ID_BASE_URL no está configurada en el .env');
    }
    return base;
  }

  private get timeoutMs(): number {
    const raw = Number(process.env.VITAL_ID_TIMEOUT_MS || '5000');
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }

  /**
   * Valida el accessToken contra Vital ID y devuelve el vital_id (UUID).
   * Lanza UnauthorizedException si el token no es válido o expiró.
   */
  async resolveVitalId(accessToken: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/oauth/userinfo`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedException({
          code: 'B8',
          message:
            'Tu sesión expiró o fue revocada. Vuelve a conectar tu cuenta en la aplicación.',
          error: 'Unauthorized',
        });
      }

      if (!res.ok) {
        throw new UnauthorizedException({
          code: 'B8',
          message:
            'No fue posible verificar tu identidad. Intenta nuevamente más tarde.',
          error: 'Unauthorized',
        });
      }

      const data = (await res.json()) as { sub?: string };
      if (!data?.sub) {
        throw new UnauthorizedException({
          code: 'B8',
          message: 'La respuesta de identidad no contiene un identificador válido.',
          error: 'Unauthorized',
        });
      }

      return data.sub;
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      if (err?.name === 'AbortError') {
        throw new UnauthorizedException({
          code: 'B8',
          message: 'El servicio de identidad tardó demasiado en responder.',
          error: 'Gateway Timeout',
        });
      }
      console.error('Error al resolver identidad en Vital ID:', err?.message || err);
      throw new UnauthorizedException({
        code: 'B8',
        message: 'No fue posible verificar tu identidad en este momento.',
        error: 'Unauthorized',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

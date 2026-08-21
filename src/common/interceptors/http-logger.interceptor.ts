import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class HttpLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, body, query, params } = req;
    const vitalId = req.user?.vitalId ?? req.user?.vital_id ?? '-';
    const start = Date.now();

    // Log entrada (sin token completo por seguridad)
    const bodyForLog = body
      ? JSON.stringify(body).slice(0, 500)
      : '-';
    this.logger.log(
      `--> ${method} ${url} vitalId=${vitalId} body=${bodyForLog}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          const res = context.switchToHttp().getResponse();
          this.logger.log(
            `<-- ${method} ${url} ${res.statusCode} ${ms}ms vitalId=${vitalId}`,
          );
        },
        error: (err) => {
          const ms = Date.now() - start;
          this.logger.error(
            `<-- ${method} ${url} ERROR ${ms}ms vitalId=${vitalId} ${err?.message ?? err}`,
          );
        },
      }),
    );
  }
}

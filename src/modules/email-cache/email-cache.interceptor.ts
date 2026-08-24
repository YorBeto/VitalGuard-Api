import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { EmailCacheService } from './email-cache.service';

@Injectable()
export class EmailCacheInterceptor implements NestInterceptor {
  constructor(private readonly emailCache: EmailCacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    // WS context no tiene req.user, solo HTTP
    const user = req.user;
    if (user?.email && (user?.vitalId || user?.vital_id)) {
      const vitalId = user.vitalId ?? user.vital_id;
      this.emailCache.put(user.email, vitalId);
    }
    // También captura email enviado en body/query para invitaciones por email (opcional)
    return next.handle();
  }
}

import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (info) {
      console.log('🔴 Log JwtAuthGuard:', info.message);
    }

    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException(
          'Acceso no autorizado: Token inválido o no proporcionado',
        )
      );
    }
    return user;
  }
}
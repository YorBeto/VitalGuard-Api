import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string; // Contiene el vital_id (UUID)
  email: string;
  person_id?: string;
  firstName?: string;
  paternalLastName?: string;
  maternalLastName?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET ||
        'c16f28b5fc222a4700fe9e5caaa3e3c2936cc68cb70f248aada34b75fd8c35d9',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException(
        'Token inválido: falta el identificador vital_id (sub)',
      );
    }

    // Retorna vital_id para ser consumido por GetVitalId() y por el servicio de check-status
    return {
      vital_id: payload.sub,
      vitalId: payload.sub,
      email: payload.email,
      person_id: payload.person_id,
    };
  }
}
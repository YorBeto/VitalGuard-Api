import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../config/jwt-secret';

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
      secretOrKey: getJwtSecret(),
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
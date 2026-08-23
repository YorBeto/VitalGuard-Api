import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
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
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Leemos de forma segura el secreto usando ConfigService
      secretOrKey: configService.get<string>('JWT_SECRET') || 'c16f28b5fc222a4700fe9e5caaa3e3c2936cc68cb70f248aada34b75fd8c35d9',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException(
        'Token inválido: falta el identificador vital_id (sub)',
      );
    }

    return {
      vital_id: payload.sub,
      vitalId: payload.sub,
      email: payload.email,
      person_id: payload.person_id,
    };
  }
}
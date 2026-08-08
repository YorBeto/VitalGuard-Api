import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async devLogin(vitalId?: string) {
    const id = vitalId || randomUUID();
    const token = this.jwtService.sign({ sub: id, email: 'dev@vitalguard.local' });
    return { token, vitalId: id };
  }

  async checkUserStatus(vitalId: string) {
    // Buscar si el usuario ya tiene un app_profile registrado en VitalGuard
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: {
        vital_id: vitalId,
        deleted_at: null,
      },
      include: {
        roles: true,
      },
    });

    // Si no tiene perfil registrado en esta BD
    if (!appProfile) {
      return {
        vitalId,
        hasProfile: false,
        message: 'El usuario aún no ha seleccionado su rol en VitalGuard',
      };
    }

    // Si ya cuenta con perfil en VitalGuard
    return {
      vitalId,
      hasProfile: true,
      appProfile: {
        id: appProfile.id,
        roleId: appProfile.role_id,
        roleName: appProfile.roles.name,
        appName: appProfile.roles.app_name,
        isActive: appProfile.is_active,
      },
    };
  }
}
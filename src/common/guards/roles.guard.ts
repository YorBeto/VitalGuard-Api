import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

const ROLE_IDS: Record<string, number> = {
  ADMIN: 4,
  DOCTOR: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const vitalId: string | undefined = user?.vitalId || user?.vital_id || user?.sub;

    if (!vitalId) {
      throw new ForbiddenException('No se pudo determinar la identidad del usuario');
    }

    const requiredIds = requiredRoles.map((r) => ROLE_IDS[r.toUpperCase()] ?? Number(r)).filter(Boolean);

    const profile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null, role_id: { in: requiredIds } },
    });

    if (!profile) {
      const roleNames = requiredRoles.join(', ');
      throw new ForbiddenException(`Se requiere rol: ${roleNames}`);
    }

    // Adjuntar role_id para uso posterior si se necesita
    request.user.role_id = profile.role_id;
    request.user.app_profile_id = profile.id;

    return true;
  }
}

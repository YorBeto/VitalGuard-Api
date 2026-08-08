import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) {
      throw new NotFoundException('Perfil de usuario no encontrado');
    }

    return this.prisma.notifications.findMany({
      where: { app_profile_id: appProfile.id, deleted_at: null },
      orderBy: { created_at: 'desc' },
      include: {
        patients: {
          select: { id: true, first_name: true, paternal_last_name: true },
        },
      },
    });
  }

  async markAsRead(id: number, vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) {
      throw new NotFoundException('Perfil de usuario no encontrado');
    }

    const notification = await this.prisma.notifications.findFirst({
      where: { id, app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }

    return this.prisma.notifications.update({
      where: { id },
      data: { is_read: true },
    });
  }

  async markAllAsRead(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) {
      throw new NotFoundException('Perfil de usuario no encontrado');
    }

    await this.prisma.notifications.updateMany({
      where: { app_profile_id: appProfile.id, is_read: false, deleted_at: null },
      data: { is_read: true },
    });

    return { message: 'Todas las notificaciones marcadas como leídas' };
  }
}

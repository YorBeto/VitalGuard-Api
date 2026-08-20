import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, notification_type } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService } from './fcm.service';

export interface CreateNotificationInput {
  title: string;
  message: string;
  type: notification_type;
  patientId?: number | null;
  metadata?: Prisma.InputJsonValue;
  route?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmService: FcmService,
  ) {}

  private async getAppProfile(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) {
      throw new NotFoundException('Perfil de usuario no encontrado');
    }
    return appProfile;
  }

  async registerToken(vitalId: string, token: string, platform?: string) {
    const appProfile = await this.getAppProfile(vitalId);

    const existing = await this.prisma.device_tokens.findFirst({
      where: { token, deleted_at: null },
    });
    if (existing) {
      // El token ya existe: asegurar que apunte a este perfil
      if (existing.app_profile_id !== appProfile.id) {
        return this.prisma.device_tokens.update({
          where: { id: existing.id },
          data: { app_profile_id: appProfile.id, platform: platform ?? null },
        });
      }
      return existing;
    }

    return this.prisma.device_tokens.create({
      data: {
        app_profile_id: appProfile.id,
        token,
        platform: platform ?? null,
      },
    });
  }

  async unreadCount(vitalId: string) {
    const appProfile = await this.getAppProfile(vitalId);
    const count = await this.prisma.notifications.count({
      where: {
        app_profile_id: appProfile.id,
        is_read: false,
        deleted_at: null,
      },
    });
    return { count };
  }

  /** Envía push FCM a todos los dispositivos de un perfil. No lanza si no hay tokens. */
  async pushToProfile(
    appProfileId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    const tokens = await this.getTokens(appProfileId);
    await this.fcmService.send({
      tokens,
      title,
      body,
      data,
    });
  }

  private async getTokens(appProfileId: number): Promise<string[]> {
    const rows = await this.prisma.device_tokens.findMany({
      where: { app_profile_id: appProfileId, deleted_at: null },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /** Crea la fila de notificación en BD y, además, dispara el push FCM al perfil. */
  async createAndPush(appProfileId: number, input: CreateNotificationInput) {
    const notif = await this.prisma.notifications.create({
      data: {
        app_profile_id: appProfileId,
        patient_id: input.patientId ?? null,
        title: input.title,
        message: input.message,
        type: input.type,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
    await this.fcmService.send({
      tokens: await this.getTokens(appProfileId),
      title: input.title,
      body: input.message,
      data: {
        id: String(notif.id),
        title: input.title,
        body: input.message,
        type: input.type,
        route: input.route ?? '',
      },
    });
    return notif;
  }

  /**
   * Devuelve los app_profile_id de todos los cuidadores vinculados a un paciente
   * (relación caregiver_patient). Opcionalmente excluye un perfil (p. ej. el actor).
   */
  async caregiverProfilesForPatient(
    patientId: number,
    excludeProfileId?: number,
  ): Promise<number[]> {
    const links = await this.prisma.caregiver_patient.findMany({
      where: { patient_id: patientId, deleted_at: null },
      select: { caregiver_id: true },
    });
    if (links.length === 0) return [];

    const caregivers = await this.prisma.caregivers.findMany({
      where: {
        id: { in: links.map((l) => l.caregiver_id) },
        deleted_at: null,
      },
      select: { app_profile_id: true },
    });

    return caregivers
      .map((c) => c.app_profile_id)
      .filter((id) => id !== excludeProfileId);
  }

  async findAllByUser(vitalId: string) {
    const appProfile = await this.getAppProfile(vitalId);

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
    const appProfile = await this.getAppProfile(vitalId);

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
    const appProfile = await this.getAppProfile(vitalId);

    await this.prisma.notifications.updateMany({
      where: {
        app_profile_id: appProfile.id,
        is_read: false,
        deleted_at: null,
      },
      data: { is_read: true },
    });

    return { message: 'Todas las notificaciones marcadas como leídas' };
  }
}

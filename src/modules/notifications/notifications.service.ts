import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  private readonly logger = new Logger(NotificationsService.name);
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
    const tokenPreview = token.slice(0, 12) + '...';
    this.logger.log(`[registerToken] vitalId=${vitalId} token=${tokenPreview} platform=${platform ?? '-'} `);
    let appProfile;
    try {
      appProfile = await this.getAppProfile(vitalId);
    } catch (e) {
      this.logger.error(`[registerToken] vitalId=${vitalId} perfil no encontrado. ¿AppProfile no existe? ${(e as Error).message}`);
      throw e;
    }
    this.logger.log(`[registerToken] appProfileId=${appProfile.id} vitalId=${vitalId}`);

    let deviceToken;
    const existing = await this.prisma.device_tokens.findFirst({
      where: { token, deleted_at: null },
    });
    if (existing) {
      if (existing.app_profile_id !== appProfile.id) {
        this.logger.log(`[registerToken] Token ${tokenPreview} reasignado de profile ${existing.app_profile_id} -> ${appProfile.id}`);
        deviceToken = await this.prisma.device_tokens.update({
          where: { id: existing.id },
          data: { app_profile_id: appProfile.id, platform: platform ?? null },
        });
      } else {
        this.logger.log(`[registerToken] Token ${tokenPreview} ya existe para profile ${appProfile.id}, id=${existing.id}`);
        deviceToken = existing;
      }
    } else {
      deviceToken = await this.prisma.device_tokens.create({
        data: {
          app_profile_id: appProfile.id,
          token,
          platform: platform ?? null,
        },
      });
      this.logger.log(`[registerToken] NUEVO token ${tokenPreview} creado id=${deviceToken.id} profile=${appProfile.id} platform=${platform ?? '-'}`);
    }

    // Fix race: repush invitaciones pendientes
    this.repushPendingInvitations(appProfile.id, vitalId).catch((e) =>
      this.logger.warn(`[registerToken] repushPendingInvitations failed: ${(e as Error).message}`),
    );

    // También loguea conteo actual de tokens del perfil
    const count = await this.prisma.device_tokens.count({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
    this.logger.log(`[registerToken] OK vitalId=${vitalId} profile=${appProfile.id} tokens_activos=${count}`);

    return deviceToken;
  }

  private async repushPendingInvitations(appProfileId: number, vitalId: string) {
    this.logger.log(`[repush] buscando invitaciones pendientes vitalId=${vitalId} profile=${appProfileId}`);
    const pendingInvites = await this.prisma.patient_invitations.findMany({
      where: { invitee_vital_id: vitalId, status: 'PENDIENTE', deleted_at: null },
      include: { patients: true },
    });
    this.logger.log(`[repush] encontradas ${pendingInvites.length} invitaciones pendientes`);
    if (pendingInvites.length === 0) return;

    for (const inv of pendingInvites) {
      // Asegura que exista la fila de notificación (puede no existir si fue por email antes)
      let notif = await this.prisma.notifications.findFirst({
        where: {
          app_profile_id: appProfileId,
          type: 'INVITACION_CUIDADOR',
          metadata: { path: ['invitation_id'], equals: inv.id },
          deleted_at: null,
        },
      });
      if (!notif) {
        const actionLabel = inv.invitee_role === 'DOCTOR' ? 'atender a' : 'cuidar a';
        notif = await this.prisma.notifications.create({
          data: {
            app_profile_id: appProfileId,
            patient_id: inv.patient_id,
            title: inv.invitee_role === 'DOCTOR' ? 'Invitación para atender' : 'Invitación para cuidar',
            message: `Has sido invitado a ${actionLabel} ${inv.patients.first_name} ${inv.patients.paternal_last_name}`,
            type: 'INVITACION_CUIDADOR',
            metadata: { invitation_id: inv.id, patient_id: inv.patient_id },
          },
        });
      }
      // Solo re-push si aún no leída (evita spam)
      if (notif.is_read) continue;

      const tokens = await this.getTokens(appProfileId);
      this.logger.log(`[repush] invitación ${inv.id} notif ${notif.id} is_read=${notif.is_read} tokens=${tokens.length}`);
      await this.fcmService.send({
        tokens,
        title: notif.title,
        body: notif.message,
        data: {
          id: String(notif.id),
          title: notif.title,
          body: notif.message,
          type: 'INVITACION_CUIDADOR',
          route: 'invitations',
          patientId: String(inv.patient_id),
          invitationId: String(inv.id),
        },
        channelId: 'vitalguard_invitations',
        priority: 'high',
      });
      this.logger.log(`[repush] OK invitación ${inv.id} -> profile ${appProfileId} notif ${notif.id}`);
    }
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
    const type = data?.type;
    await this.fcmService.send({
      tokens,
      title,
      body,
      data,
      channelId:
        type === 'SOS_ALERTA'
          ? 'vitalguard_sos'
          : type === 'INVITACION_CUIDADOR'
            ? 'vitalguard_invitations'
            : type === 'DOSIS_RECORDATORIO'
              ? 'vitalguard_medication'
              : undefined,
      priority: type === 'SOS_ALERTA' ? 'high' : 'high',
    });
  }

  private async getTokens(appProfileId: number): Promise<string[]> {
    const rows = await this.prisma.device_tokens.findMany({
      where: { app_profile_id: appProfileId, deleted_at: null },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  async removeToken(vitalId: string, token: string) {
    const appProfile = await this.getAppProfile(vitalId);
    const existing = await this.prisma.device_tokens.findFirst({
      where: { token, app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!existing) return { message: 'Token no encontrado' };
    await this.prisma.device_tokens.update({
      where: { id: existing.id },
      data: { deleted_at: new Date() },
    });
    return { message: 'Token eliminado' };
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
    const data: Record<string, string> = {
      id: String(notif.id),
      title: input.title,
      body: input.message,
      type: input.type,
      route: input.route ?? '',
      ...(input.patientId ? { patientId: String(input.patientId) } : {}),
      ...(input.metadata
        ? {
            metadata: JSON.stringify(input.metadata).slice(0, 900),
            invitationId: String((input.metadata as any)?.invitation_id ?? ''),
          }
        : {}),
    };
    // Limpia claves vacías (FCM no acepta undefined)
    Object.keys(data).forEach((k) => {
      if (!data[k]) delete data[k];
    });
    await this.fcmService.send({
      tokens: await this.getTokens(appProfileId),
      title: input.title,
      body: input.message,
      data,
      channelId:
        input.type === 'SOS_ALERTA'
          ? 'vitalguard_sos'
          : input.type === 'INVITACION_CUIDADOR'
            ? 'vitalguard_invitations'
            : input.type === 'DOSIS_RECORDATORIO'
              ? 'vitalguard_medication'
              : undefined,
      priority: input.type === 'SOS_ALERTA' ? 'high' : 'high',
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

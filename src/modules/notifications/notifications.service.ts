import { Injectable, Logger, NotFoundException, Inject, forwardRef, Optional } from '@nestjs/common';
import { Prisma, notification_type } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService } from './fcm.service';
import { RealtimeService } from '../realtime/realtime.service';
import { EmailCacheService } from '../email-cache/email-cache.service';

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
    @Optional()
    @Inject(forwardRef(() => RealtimeService))
    private readonly realtimeService: RealtimeService,
    private readonly emailCache: EmailCacheService,
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

  /** Obtiene todos los app_profile ids de un vital_id (un usuario puede tener varios roles) */
  private async getAppProfileIds(vitalId: string): Promise<number[]> {
    const profiles = await this.prisma.app_profiles.findMany({
      where: { vital_id: vitalId, deleted_at: null },
      select: { id: true },
    });
    if (profiles.length === 0) {
      throw new NotFoundException('Perfil de usuario no encontrado');
    }
    return profiles.map((p) => p.id);
  }

  /** Prefiere el perfil CAREGIVER para registro de token */
  private async getPreferredAppProfile(vitalId: string) {
    const profiles = await this.prisma.app_profiles.findMany({
      where: { vital_id: vitalId, deleted_at: null },
      include: { roles: true },
      orderBy: { id: 'asc' },
    });
    if (profiles.length === 0) throw new NotFoundException('Perfil de usuario no encontrado');
    const caregiver = profiles.find((p) => p.roles?.name === 'CAREGIVER');
    return caregiver ?? profiles[0];
  }

  async registerToken(vitalId: string, token: string, platform?: string, email?: string) {
    const tokenPreview = token.slice(0, 12) + '...';
    this.logger.log(`[registerToken] vitalId=${vitalId} token=${tokenPreview} platform=${platform ?? '-'} email=${email ?? '-'}`);
    if (email) this.emailCache.put(email, vitalId);
    let appProfile;
    try {
      appProfile = await this.getPreferredAppProfile(vitalId);
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
          data: { app_profile_id: appProfile.id, platform: platform ?? null, deleted_at: null, updated_at: new Date() },
        });
      } else {
        this.logger.log(`[registerToken] Token ${tokenPreview} ya existe para profile ${appProfile.id}, id=${existing.id}`);
        // Reactivar si estaba soft-deleted previamente y actualizar platform
        if (existing.deleted_at) {
          deviceToken = await this.prisma.device_tokens.update({
            where: { id: existing.id },
            data: { deleted_at: null, platform: platform ?? null },
          });
        } else {
          deviceToken = existing;
        }
      }
    } else {
      // Si el token estaba soft-deleted con mismo valor, Prisma unique fallaría -> buscar incluyendo deleted
      const softDeleted = await this.prisma.device_tokens.findFirst({
        where: { token },
      });
      if (softDeleted) {
        deviceToken = await this.prisma.device_tokens.update({
          where: { id: softDeleted.id },
          data: { app_profile_id: appProfile.id, platform: platform ?? null, deleted_at: null, updated_at: new Date() },
        });
        this.logger.log(`[registerToken] Token ${tokenPreview} reactivado id=${deviceToken.id} profile=${appProfile.id}`);
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
    }

    // Fix race: repush invitaciones pendientes (vital_id + email)
    this.repushPendingInvitations(appProfile.id, vitalId, email).catch((e) =>
      this.logger.warn(`[registerToken] repushPendingInvitations failed: ${(e as Error).message}`),
    );

    // También loguea conteo actual de tokens del usuario (todos sus perfiles)
    const allIds = await this.getAppProfileIds(vitalId);
    const count = await this.prisma.device_tokens.count({
      where: { app_profile_id: { in: allIds }, deleted_at: null },
    });
    this.logger.log(`[registerToken] OK vitalId=${vitalId} profile=${appProfile.id} tokens_activos=${count} (en ${allIds.length} perfiles)`);

    return deviceToken;
  }

  private async repushPendingInvitations(appProfileId: number, vitalId: string, email?: string) {
    this.logger.log(`[repush] buscando invitaciones pendientes vitalId=${vitalId} email=${email ?? '-'} profile=${appProfileId}`);
    // Buscar por vital_id y, si tenemos email, también por invitee_email (caso invitaciones por correo)
    const or: any[] = [{ invitee_vital_id: vitalId }];
    if (email && email.trim()) {
      or.push({ invitee_email: { equals: email.trim(), mode: 'insensitive' } });
    }
    const pendingInvites = await this.prisma.patient_invitations.findMany({
      where: { status: 'PENDIENTE', deleted_at: null, OR: or },
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
      // WS en tiempo real además de FCM
      const prof = await this.prisma.app_profiles.findUnique({ where: { id: appProfileId }, select: { vital_id: true } });
      if (prof) this.realtimeService.emitToVital(prof.vital_id, 'notification:new', notif);
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
    const ids = await this.getAppProfileIds(vitalId);
    const count = await this.prisma.notifications.count({
      where: {
        app_profile_id: { in: ids },
        is_read: false,
        deleted_at: null,
      },
    });
    return { count };
  }

  /** Envía push FCM + WS a todos los dispositivos de un vital_id. No lanza si no hay tokens. */
  async pushToProfile(
    appProfileId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    // WS: emitir evento liviano (para casos donde la notificación ya existe en BD)
    try {
      const profile = await this.prisma.app_profiles.findUnique({
        where: { id: appProfileId },
        select: { vital_id: true },
      });
      if (profile) {
        // Si data trae id, lo usamos para buscar la notificación real
        if (data?.id) {
          const notif = await this.prisma.notifications.findUnique({ where: { id: Number(data.id) } });
          if (notif) this.realtimeService.emitToVital(profile.vital_id, 'notification:new', notif);
          else this.realtimeService.emitToVital(profile.vital_id, 'notification:new', { title, message: body, type: data?.type, ...data });
        } else {
          this.realtimeService.emitToVital(profile.vital_id, 'notification:new', { title, message: body, type: data?.type, ...data });
        }
      }
    } catch {}
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
    // Agrega tokens de TODOS los perfiles del mismo vital_id para evitar desvío por rol
    const profile = await this.prisma.app_profiles.findUnique({
      where: { id: appProfileId },
      select: { vital_id: true },
    });
    if (!profile) return [];
    const allIds = await this.prisma.app_profiles.findMany({
      where: { vital_id: profile.vital_id, deleted_at: null },
      select: { id: true },
    });
    const ids = allIds.map((p) => p.id);
    const rows = await this.prisma.device_tokens.findMany({
      where: { app_profile_id: { in: ids }, deleted_at: null },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  async removeToken(vitalId: string, token: string) {
    const ids = await this.getAppProfileIds(vitalId);
    const existing = await this.prisma.device_tokens.findFirst({
      where: { token, app_profile_id: { in: ids }, deleted_at: null },
    });
    if (!existing) return { message: 'Token no encontrado' };
    await this.prisma.device_tokens.update({
      where: { id: existing.id },
      data: { deleted_at: new Date() },
    });
    return { message: 'Token eliminado' };
  }

  private async emitRealtime(appProfileId: number, notif: any) {
    if (!this.realtimeService) return;
    try {
      const profile = await this.prisma.app_profiles.findUnique({
        where: { id: appProfileId },
        select: { vital_id: true },
      });
      if (!profile) return;
      // WS: notificación completa
      this.realtimeService.emitToVital(profile.vital_id, 'notification:new', notif);
      // WS: unread count actualizado
      const allIds = await this.prisma.app_profiles.findMany({
        where: { vital_id: profile.vital_id, deleted_at: null },
        select: { id: true },
      });
      const ids = allIds.map((p) => p.id);
      const count = await this.prisma.notifications.count({
        where: { app_profile_id: { in: ids }, is_read: false, deleted_at: null },
      });
      this.realtimeService.emitToVital(profile.vital_id, 'notification:unread-count', { count });
    } catch (e) {
      this.logger.warn(`[realtime] emit falló: ${(e as Error).message}`);
    }
  }

  /** Crea la fila de notificación en BD y, además, dispara el push FCM + WS al perfil. */
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
    // WS inmediato (sin esperar FCM)
    this.emitRealtime(appProfileId, notif).catch(() => {});

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
    const ids = await this.getAppProfileIds(vitalId);

    return this.prisma.notifications.findMany({
      where: { app_profile_id: { in: ids }, deleted_at: null },
      orderBy: { created_at: 'desc' },
      include: {
        patients: {
          select: { id: true, first_name: true, paternal_last_name: true },
        },
      },
    });
  }

  async markAsRead(id: number, vitalId: string) {
    const ids = await this.getAppProfileIds(vitalId);

    const notification = await this.prisma.notifications.findFirst({
      where: { id, app_profile_id: { in: ids }, deleted_at: null },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }

    const updated = await this.prisma.notifications.update({
      where: { id },
      data: { is_read: true },
    });
    // WS: notificar actualización de lectura
    this.realtimeService.emitToVital(vitalId, 'notification:read', { id });
    const count = await this.prisma.notifications.count({
      where: { app_profile_id: { in: ids }, is_read: false, deleted_at: null },
    });
    this.realtimeService.emitToVital(vitalId, 'notification:unread-count', { count });
    return updated;
  }

  async markAllAsRead(vitalId: string) {
    const ids = await this.getAppProfileIds(vitalId);

    await this.prisma.notifications.updateMany({
      where: {
        app_profile_id: { in: ids },
        is_read: false,
        deleted_at: null,
      },
      data: { is_read: true },
    });
    this.realtimeService.emitToVital(vitalId, 'notification:read-all', {});
    this.realtimeService.emitToVital(vitalId, 'notification:unread-count', { count: 0 });

    return { message: 'Todas las notificaciones marcadas como leídas' };
  }
}

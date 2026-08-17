import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { Prisma, notification_type } from '@prisma/client';

const INVITATION_TTL_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getCaregiverByVitalId(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) return null;

    return this.prisma.caregivers.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
  }

  private async getCaregiverOrThrow(vitalId: string) {
    const caregiver = await this.getCaregiverByVitalId(vitalId);
    if (!caregiver) {
      throw new NotFoundException('Perfil de cuidador no encontrado');
    }
    return caregiver;
  }

  private async assertCaresForPatient(caregiverId: number, patientId: number) {
    const relation = await this.prisma.caregiver_patient.findFirst({
      where: {
        caregiver_id: caregiverId,
        patient_id: patientId,
        deleted_at: null,
      },
    });
    if (!relation) {
      throw new ForbiddenException('No tienes acceso a este paciente');
    }
  }

  private async notifyProfile(
    appProfileId: number,
    title: string,
    message: string,
    type: notification_type,
    patientId?: number | null,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.notifications.create({
      data: {
        app_profile_id: appProfileId,
        patient_id: patientId ?? null,
        title,
        message,
        type,
        metadata: metadata ?? Prisma.JsonNull,
      },
    });
  }

  async create(vitalId: string, patientId: number, dto: CreateInvitationDto) {
    const inviter = await this.getCaregiverOrThrow(vitalId);
    await this.assertCaresForPatient(inviter.id, patientId);

    if (!dto.inviteeVitalId && !dto.inviteeEmail) {
      throw new BadRequestException(
        'Debes indicar el vital_id del invitado o su email para invitarlo',
      );
    }

    if (dto.inviteeVitalId && dto.inviteeVitalId === vitalId) {
      throw new BadRequestException('No puedes invitarte a ti mismo');
    }

    // No permitir invitar a alguien que ya está vinculado al paciente
    if (dto.inviteeVitalId) {
      const existing = await this.prisma.app_profiles.findFirst({
        where: { vital_id: dto.inviteeVitalId, deleted_at: null },
        include: { caregivers: true },
      });
      if (existing?.caregivers) {
        const alreadyLinked = await this.prisma.caregiver_patient.findFirst({
          where: {
            caregiver_id: existing.caregivers.id,
            patient_id: patientId,
            deleted_at: null,
          },
        });
        if (alreadyLinked) {
          throw new ConflictException(
            'La persona que intentas invitar ya es cuidador de este paciente',
          );
        }
      }
    }

    // Evitar invitaciones duplicadas pendientes para el mismo paciente
    const or: Prisma.patient_invitationsWhereInput[] = [];
    if (dto.inviteeVitalId) {
      or.push({ invitee_vital_id: dto.inviteeVitalId });
    }
    if (dto.inviteeEmail) {
      or.push({
        invitee_email: { equals: dto.inviteeEmail, mode: 'insensitive' },
      });
    }
    const duplicate = await this.prisma.patient_invitations.findFirst({
      where: {
        patient_id: patientId,
        status: 'PENDIENTE',
        deleted_at: null,
        OR: or,
      },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ya existe una invitación pendiente para esta persona en este paciente',
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    const invitation = await this.prisma.patient_invitations.create({
      data: {
        patient_id: patientId,
        invited_by_caregiver_id: inviter.id,
        invitee_vital_id: dto.inviteeVitalId ?? null,
        invitee_email: dto.inviteeEmail ?? null,
        invitee_role: dto.inviteeRole ?? 'CAREGIVER',
        kinship: dto.kinship ?? null,
        token: dto.inviteeEmail ? randomBytes(24).toString('hex') : null,
        expires_at: expiresAt,
      },
      include: { patients: true },
    });

    // Si el invitado ya es usuario, notificarlo in-app
    if (dto.inviteeVitalId) {
      const inviteeProfile = await this.prisma.app_profiles.findFirst({
        where: { vital_id: dto.inviteeVitalId, deleted_at: null },
      });
      if (inviteeProfile) {
        const message = `Has sido invitado a cuidar a ${invitation.patients.first_name} ${invitation.patients.paternal_last_name}`;
        const notif = await this.notifyProfile(
          inviteeProfile.id,
          'Invitación para cuidar',
          message,
          'INVITACION_CUIDADOR',
          patientId,
          { invitation_id: invitation.id },
        );
        await this.notificationsService.pushToProfile(
          inviteeProfile.id,
          'Invitación para cuidar',
          message,
          this.pushData(
            notif.id,
            'Invitación para cuidar',
            message,
            'invitations',
          ),
        );
      }
    }

    // Enviar el correo de invitación por Resend
    if (dto.inviteeEmail && invitation.token) {
      await this.sendInvitationEmail(invitation, dto.message);
    }

    return invitation;
  }

  private async sendInvitationEmail(
    invitation: {
      id: number;
      token: string | null;
      invitee_email: string | null;
      kinship: string | null;
      patients: { first_name: string; paternal_last_name: string };
    },
    message?: string,
  ) {
    const deepLink = `vitalguard://invite/${invitation.token}`;
    const patientName = `${invitation.patients.first_name} ${invitation.patients.paternal_last_name}`;
    const kinshipLabel =
      invitation.kinship === 'Otro' || !invitation.kinship
        ? 'cuidador(a)'
        : invitation.kinship;
    const code = this.formatCode(invitation.token);

    const messageBlock = message
      ? `<p style="color:#0f172a;background:#f1f5f9;border-left:3px solid #0284c7;padding:12px 16px;border-radius:8px;font-size:14px">“${this.escapeHtml(message)}”</p>`
      : '';

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <div style="background:#0284c7;border-radius:12px 12px 0 0;padding:24px 28px">
          <h1 style="color:#ffffff;margin:0;font-size:20px">Te han invitado a cuidar a ${patientName}</h1>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:28px">
          <p>Hola,</p>
          <p>Alguien te ha invitado a ser <strong>${kinshipLabel}</strong> de <strong>${patientName}</strong> en <strong>VitalGuard</strong>.</p>
          ${messageBlock}
          <h3 style="margin:24px 0 12px;color:#0f172a">¿Cómo aceptar?</h3>
          <ol style="color:#334155;font-size:14px;line-height:1.7;padding-left:20px">
            <li>Abre la aplicación <strong>VitalGuard</strong> e inicia sesión con el correo <strong>${invitation.invitee_email}</strong>.</li>
            <li>Entra al apartado de <strong>Invitaciones</strong>.</li>
            <li>Verás la invitación de <strong>${patientName}</strong> lista para aceptar.</li>
          </ol>
          <p style="margin:24px 0 8px;color:#334155;font-size:13px">Si la invitación no aparece, abre la app y escribe este código:</p>
          <div style="background:#f8fafc;border:1px dashed #94a3b8;border-radius:8px;padding:12px;text-align:center;margin:8px 0 24px">
            <span style="font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:2px;color:#0284c7">${code}</span>
          </div>
          <p style="text-align:center;margin:24px 0">
            <a href="${deepLink}" style="background:#0284c7;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">Abrir VitalGuard</a>
          </p>
          <p style="color:#64748b;font-size:12px">Este enlace y el código son válidos por ${INVITATION_TTL_DAYS} días. Si no esperabas esta invitación, puedes ignorar este correo.</p>
        </div>
      </div>
    `;

    await this.mailService.send({
      to: invitation.invitee_email!,
      subject: `Invitación para cuidar a ${patientName} en VitalGuard`,
      html,
    });

    await this.prisma.patient_invitations.update({
      where: { id: invitation.id },
      data: { email_delivered: true },
    });
  }

  private formatCode(token: string | null) {
    const clean = (token ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return clean.match(/.{1,8}/g)?.join('-') ?? 'NO DISPONIBLE';
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async acceptByToken(vitalId: string, token: string) {
    const invitation = await this.prisma.patient_invitations.findFirst({
      where: { token, deleted_at: null },
    });
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }
    return this.accept(vitalId, invitation.id, token);
  }

  async findPending(vitalId: string, email?: string) {
    const profile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!profile) return [];

    const or: Prisma.patient_invitationsWhereInput[] = [
      { invitee_vital_id: vitalId },
    ];
    if (email && email.trim()) {
      or.push({
        invitee_email: { equals: email.trim(), mode: 'insensitive' },
      });
    }

    const invitations = await this.prisma.patient_invitations.findMany({
      where: {
        status: 'PENDIENTE',
        deleted_at: null,
        OR: or,
      },
      include: {
        patients: true,
        caregivers: { include: { app_profiles: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    // Invitaciones por email: crear la notificación in-app la primera vez
    // que el invitado (ya identificado por su correo) consulta sus pendientes.
    if (email && email.trim()) {
      const target = email.trim().toLowerCase();
      for (const invitation of invitations) {
        if (!invitation.invitee_email) continue;
        if (invitation.invitee_email.toLowerCase() !== target) continue;
        const existing = await this.prisma.notifications.findFirst({
          where: {
            app_profile_id: profile.id,
            metadata: { path: ['invitation_id'], equals: invitation.id },
            deleted_at: null,
          },
        });
        if (existing) continue;
        const patient = invitation.patients;
        await this.notifyProfile(
          profile.id,
          'Invitación para cuidar',
          `Has sido invitado a cuidar a ${patient.first_name} ${patient.paternal_last_name}`,
          'INVITACION_CUIDADOR',
          invitation.patient_id,
          { invitation_id: invitation.id },
        );
      }
    }

    return invitations;
  }

  async findSent(vitalId: string) {
    const caregiver = await this.getCaregiverOrThrow(vitalId);
    return this.prisma.patient_invitations.findMany({
      where: { invited_by_caregiver_id: caregiver.id, deleted_at: null },
      include: { patients: true },
      orderBy: { created_at: 'desc' },
    });
  }

  private async getPendingForInvitee(
    invitationId: number,
    vitalId: string,
    token?: string,
    email?: string,
  ) {
    const invitation = await this.prisma.patient_invitations.findFirst({
      where: { id: invitationId, deleted_at: null },
    });
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    if (invitation.status === 'ACEPTADA') {
      throw new ConflictException('Esta invitación ya fue aceptada');
    }
    if (invitation.status === 'RECHAZADA') {
      throw new ConflictException('Esta invitación ya fue rechazada');
    }
    if (invitation.status === 'CANCELADA') {
      throw new ConflictException(
        'Esta invitación fue cancelada por el remitente',
      );
    }
    if (invitation.status !== 'PENDIENTE') {
      throw new GoneException('Esta invitación ya no está disponible');
    }

    if (invitation.expires_at && invitation.expires_at < new Date()) {
      await this.prisma.patient_invitations.update({
        where: { id: invitationId },
        data: { status: 'EXPIRADA' },
      });
      throw new GoneException('Esta invitación ha expirado');
    }

    // Autorización según cómo fue invitado
    if (invitation.invitee_vital_id) {
      if (invitation.invitee_vital_id !== vitalId) {
        throw new ForbiddenException('No tienes permiso para esta invitación');
      }
    } else if (invitation.invitee_email) {
      const matchesEmail =
        !!email &&
        email.trim().toLowerCase() ===
          invitation.invitee_email.trim().toLowerCase();
      const matchesToken = !!token && token === invitation.token;
      if (!matchesEmail && !matchesToken) {
        throw new ForbiddenException('Token de invitación inválido o faltante');
      }
    }

    return invitation;
  }

  async accept(vitalId: string, invitationId: number, token?: string, email?: string) {
    const invitation = await this.getPendingForInvitee(
      invitationId,
      vitalId,
      token,
      email,
    );

    const invitee = await this.getCaregiverOrThrow(vitalId);

    return this.prisma
      .$transaction(async (tx) => {
        const existingLink = await tx.caregiver_patient.findFirst({
          where: {
            caregiver_id: invitee.id,
            patient_id: invitation.patient_id,
            deleted_at: null,
          },
        });

        if (!existingLink && invitation.invitee_role === 'CAREGIVER') {
          await tx.caregiver_patient.create({
            data: {
              caregiver_id: invitee.id,
              patient_id: invitation.patient_id,
              kinship: invitation.kinship ?? 'Otro',
            },
          });
        }

        const updated = await tx.patient_invitations.update({
          where: { id: invitation.id },
          data: {
            status: 'ACEPTADA',
            responded_at: new Date(),
            invitee_vital_id: vitalId,
          },
          include: { patients: true },
        });

        // Notificar al remitente que su invitación fue aceptada
        const inviter = await tx.caregivers.findUnique({
          where: { id: invitation.invited_by_caregiver_id },
        });
        if (inviter) {
          await tx.notifications.create({
            data: {
              app_profile_id: inviter.app_profile_id,
              patient_id: invitation.patient_id,
              title: 'Invitación aceptada',
              message: `Tu invitación para cuidar a ${updated.patients.first_name} ${updated.patients.paternal_last_name} fue aceptada`,
              type: 'INVITACION_CUIDADOR',
              metadata: { invitation_id: invitation.id },
            },
          });
        }

        return { updated, inviterProfileId: inviter?.app_profile_id ?? null };
      })
      .then(async ({ updated, inviterProfileId }) => {
        if (inviterProfileId) {
          const title = 'Invitación aceptada';
          const message = `Tu invitación para cuidar a ${updated.patients.first_name} ${updated.patients.paternal_last_name} fue aceptada`;
          await this.notificationsService.pushToProfile(
            inviterProfileId,
            title,
            message,
            this.pushData(updated.id, title, message, 'family'),
          );
        }
        return updated;
      });
  }

  private pushData(
    id: number,
    title: string,
    body: string,
    route: string,
  ): Record<string, string> {
    return {
      id: String(id),
      title,
      body,
      type: 'INVITACION_CUIDADOR',
      route,
    };
  }

  async reject(vitalId: string, invitationId: number, token?: string, email?: string) {
    const invitation = await this.getPendingForInvitee(
      invitationId,
      vitalId,
      token,
      email,
    );

    const updated = await this.prisma.patient_invitations.update({
      where: { id: invitation.id },
      data: { status: 'RECHAZADA', responded_at: new Date() },
      include: { patients: true },
    });

    const inviter = await this.prisma.caregivers.findUnique({
      where: { id: invitation.invited_by_caregiver_id },
    });
    if (inviter) {
      const title = 'Invitación rechazada';
      const message = `Tu invitación para cuidar a ${updated.patients.first_name} ${updated.patients.paternal_last_name} fue rechazada`;
      await this.notifyProfile(
        inviter.app_profile_id,
        title,
        message,
        'INVITACION_CUIDADOR',
        invitation.patient_id,
        { invitation_id: invitation.id },
      );
      await this.notificationsService.pushToProfile(
        inviter.app_profile_id,
        title,
        message,
        this.pushData(updated.id, title, message, 'family'),
      );
    }

    return updated;
  }

  async cancel(vitalId: string, invitationId: number) {
    const inviter = await this.getCaregiverOrThrow(vitalId);

    const invitation = await this.prisma.patient_invitations.findFirst({
      where: { id: invitationId, deleted_at: null },
    });
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }
    if (invitation.invited_by_caregiver_id !== inviter.id) {
      throw new ForbiddenException(
        'Solo el remitente puede cancelar esta invitación',
      );
    }
    if (invitation.status !== 'PENDIENTE') {
      throw new ConflictException(
        'Solo se pueden cancelar invitaciones pendientes',
      );
    }

    return this.prisma.patient_invitations.update({
      where: { id: invitation.id },
      data: { status: 'CANCELADA', responded_at: new Date() },
    });
  }
}

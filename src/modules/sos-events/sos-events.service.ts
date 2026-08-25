import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SosEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findActive(patientId: number) {
    return this.prisma.sos_events.findMany({
      where: { patient_id: patientId, status: 'Activo' },
      orderBy: { created_at: 'desc' },
    });
  }

  async findRecent(patientId: number, limit = 10) {
    return this.prisma.sos_events.findMany({
      where: { patient_id: patientId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  async updateStatus(eventId: number, status: 'Atendido' | 'Falsa_Alarma', caregiverVitalId?: string) {
    const event = await this.prisma.sos_events.findFirst({
      where: { id: eventId, deleted_at: null },
    });
    if (!event) throw new Error('Evento SOS no encontrado');
    let resolvingId: number | null = null;
    if (caregiverVitalId) {
      const appProfile = await this.prisma.app_profiles.findFirst({
        where: { vital_id: caregiverVitalId, deleted_at: null },
      });
      if (appProfile) {
        const caregiver = await this.prisma.caregivers.findFirst({
          where: { app_profile_id: appProfile.id, deleted_at: null },
        });
        if (caregiver) resolvingId = caregiver.id;
      }
    }
    return this.prisma.sos_events.update({
      where: { id: eventId },
      data: { status: status as any, resolving_caregiver_id: resolvingId },
    });
  }

  async create(patientId: number) {
    const event = await this.prisma.sos_events.create({
      data: {
        patient_id: patientId,
        status: 'Activo',
      },
    });

    // SOS siempre se entrega, sin filtros
    const profiles =
      await this.notificationsService.caregiverProfilesForPatient(patientId);
    for (const profileId of profiles) {
      await this.notificationsService.createAndPush(profileId, {
        title: 'Alerta SOS activada',
        message: 'Un paciente activó el botón de emergencia.',
        type: 'SOS_ALERTA',
        patientId,
        route: 'sos',
      });
    }

    return event;
  }
}

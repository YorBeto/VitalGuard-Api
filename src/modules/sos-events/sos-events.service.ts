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

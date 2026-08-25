import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PatientAccessService } from '../../common/services/patient-access.service';

@Injectable()
export class SosEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findActive(vitalId: string, patientId: number) {
    await this.patientAccess.assertHasAccessToPatient(vitalId, patientId);
    return this.prisma.sos_events.findMany({
      where: { patient_id: patientId, status: 'Activo' },
    });
  }

  async create(vitalId: string, patientId: number) {
    await this.patientAccess.assertHasAccessToPatient(vitalId, patientId);
    return this.createInternal(patientId);
  }

  /**
   * Crea el evento SOS sin verificar vitalId. Uso exclusivo de llamadores
   * de confianza internos (ej. el botón físico del dispositivo vía MQTT),
   * que no tienen un usuario autenticado detrás.
   */
  async createInternal(patientId: number) {
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

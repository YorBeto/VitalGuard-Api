import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { PatientAccessService } from '../../common/services/patient-access.service';
import { CreateScheduleDto } from './dto/schedule.dto';

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: DevicesService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findToday(vitalId: string, patientId: number) {
    await this.patientAccess.assertHasAccessToPatient(vitalId, patientId);
    const treatments = await this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      select: { id: true },
    });

    const treatmentIds = treatments.map((t) => t.id);

    return this.prisma.schedules.findMany({
      where: {
        treatment_details: {
          treatment_id: { in: treatmentIds },
          deleted_at: null,
        },
        deleted_at: null,
      },
      include: {
        treatment_details: {
          include: { medications: true },
        },
      },
    });
  }

  async create(vitalId: string, dto: CreateScheduleDto) {
    const detail = await this.prisma.treatment_details.findFirst({
      where: { id: dto.treatmentDetailId, deleted_at: null },
      include: { treatments: { select: { patient_id: true } } },
    });
    if (!detail) {
      throw new NotFoundException('Treatment detail no encontrado');
    }

    await this.patientAccess.assertHasAccessToPatient(
      vitalId,
      detail.treatments.patient_id,
    );

    const schedule = await this.prisma.schedules.create({
      data: {
        treatment_detail_id: dto.treatmentDetailId,
        time_of_day: new Date(`1970-01-01T${dto.timeOfDay}`),
      },
    });

    await this.notifyDeviceByTreatmentDetail(dto.treatmentDetailId);

    return schedule;
  }

  async remove(vitalId: string, id: number) {
    const schedule = await this.prisma.schedules.findFirst({
      where: { id, deleted_at: null },
      include: {
        treatment_details: { include: { treatments: { select: { patient_id: true } } } },
      },
    });
    if (!schedule) {
      throw new NotFoundException('Horario no encontrado');
    }

    await this.patientAccess.assertHasAccessToPatient(
      vitalId,
      schedule.treatment_details.treatments.patient_id,
    );

    await this.prisma.schedules.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await this.notifyDeviceByTreatmentDetail(schedule.treatment_detail_id);

    return { message: 'Horario eliminado exitosamente' };
  }

  private async notifyDeviceByTreatmentDetail(treatmentDetailId: number): Promise<void> {
    try {
      const detail = await this.prisma.treatment_details.findUnique({
        where: { id: treatmentDetailId },
        include: {
          treatments: { select: { patient_id: true } },
        },
      });

      if (!detail?.treatments?.patient_id) return;

      const patientId = detail.treatments.patient_id;
      const device = await this.prisma.devices.findFirst({
        where: { patient_id: patientId, deleted_at: null },
      });

      if (device) {
        await this.devicesService.sendConfigToDevice(device.unique_code, patientId);
      }
    } catch (error: any) {
      this.logger.error(
        `Error MQTT al notificar cambio de horario para el detalle ${treatmentDetailId}: ${error.message}`,
      );
    }
  }
}
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { CreateTreatmentDetailDto } from './dto/treatment-detail.dto';

@Injectable()
export class TreatmentDetailsService {
  private readonly logger = new Logger(TreatmentDetailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: DevicesService,
  ) {}

  async findByTreatment(treatmentId: number) {
    return this.prisma.treatment_details.findMany({
      where: { treatment_id: treatmentId, deleted_at: null },
      include: {
        medications: true,
        schedules: { where: { deleted_at: null } },
      },
    });
  }

  async create(dto: CreateTreatmentDetailDto) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id: dto.treatmentId, deleted_at: null },
    });
    if (!treatment) {
      throw new NotFoundException('Tratamiento no encontrado');
    }

    const medication = await this.prisma.medications.findFirst({
      where: { id: dto.medicationId, deleted_at: null },
    });
    if (!medication) {
      throw new NotFoundException('Medicamento no encontrado');
    }

    const detail = await this.prisma.treatment_details.create({
      data: {
        treatment_id: dto.treatmentId,
        medication_id: dto.medicationId,
        dose_info: dto.doseInfo ?? null,
        frequency_hours: dto.frequencyHours ?? 1,
        first_take_time: new Date(`1970-01-01T${dto.firstTakeTime}`),
        end_date: dto.endDate ? new Date(dto.endDate) : null,
        compartment_number: dto.compartmentNumber ?? null,
        is_external: dto.isExternal ?? false,
        status: dto.status ?? 'En_curso',
      },
      include: { medications: true },
    });

    // Si el tratamiento no tiene fecha fin pero el medicamento sí, auto-calcula con el de mayor duración (requisito)
    await this.recalculateTreatmentEndDate(dto.treatmentId);

    // Enviar configuración actualizada al ESP32
    await this.notifyDeviceByTreatment(dto.treatmentId);

    return detail;
  }

  private async recalculateTreatmentEndDate(treatmentId: number) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id: treatmentId, deleted_at: null },
    });
    if (!treatment) return;

    // Solo auto-calcula si el tratamiento aún no tiene fecha fin (null).
    // Si ya tiene fecha explícita, respeta la del usuario.
    if (treatment.end_date != null) {
      // Si ya tiene fecha pero un medicamento trae una fecha más tardía, extiende (max).
      const detailsWithEnd = await this.prisma.treatment_details.findMany({
        where: { treatment_id: treatmentId, deleted_at: null, end_date: { not: null } },
        select: { end_date: true },
      });
      const maxDetailDate = detailsWithEnd
        .map((d) => d.end_date as Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      if (maxDetailDate && maxDetailDate > treatment.end_date) {
        await this.prisma.treatments.update({
          where: { id: treatmentId },
          data: { end_date: maxDetailDate },
        });
        this.logger.log(`Tratamiento ${treatmentId} extendido a ${maxDetailDate.toISOString().slice(0, 10)} (detalle con mayor duración)`);
      }
      return;
    }

    const detailsWithEnd = await this.prisma.treatment_details.findMany({
      where: { treatment_id: treatmentId, deleted_at: null, end_date: { not: null } },
      select: { end_date: true },
    });
    if (detailsWithEnd.length === 0) return; // ambos null -> tratamiento crónico (ver recomendación)
    const maxDate = detailsWithEnd
      .map((d) => d.end_date as Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (maxDate) {
      await this.prisma.treatments.update({
        where: { id: treatmentId },
        data: { end_date: maxDate },
      });
      this.logger.log(`Tratamiento ${treatmentId} auto-calculado a ${maxDate.toISOString().slice(0, 10)} (max de ${detailsWithEnd.length} detalles)`);
    }
  }

  async remove(id: number) {
    const detail = await this.prisma.treatment_details.findFirst({
      where: { id, deleted_at: null },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de tratamiento no encontrado');
    }

    await this.prisma.treatment_details.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    // Si el detalle eliminado era el que marcaba el max, recalcula al siguiente max (o null)
    const treatment = await this.prisma.treatments.findFirst({ where: { id: detail.treatment_id, deleted_at: null } });
    if (treatment && detail.end_date && treatment.end_date && new Date(detail.end_date).getTime() === new Date(treatment.end_date).getTime()) {
      const remaining = await this.prisma.treatment_details.findMany({
        where: { treatment_id: detail.treatment_id, deleted_at: null, end_date: { not: null } },
        select: { end_date: true },
      });
      const newMax = remaining.map((d) => d.end_date as Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      await this.prisma.treatments.update({
        where: { id: detail.treatment_id },
        data: { end_date: newMax },
      });
      this.logger.log(`Tratamiento ${detail.treatment_id} recalculado tras borrar detalle ${id} -> ${newMax ? newMax.toISOString().slice(0, 10) : 'null (crónico)'}`);
    }

    // Enviar configuración actualizada al ESP32
    await this.notifyDeviceByTreatment(detail.treatment_id);

    return { message: 'Detalle de tratamiento eliminado exitosamente' };
  }

  private async notifyDeviceByTreatment(treatmentId: number): Promise<void> {
    try {
      const treatment = await this.prisma.treatments.findUnique({
        where: { id: treatmentId },
        select: { patient_id: true },
      });
      if (!treatment) return;

      const device = await this.prisma.devices.findFirst({
        where: { patient_id: treatment.patient_id, deleted_at: null },
      });

      if (device) {
        await this.devicesService.sendConfigToDevice(device.unique_code, treatment.patient_id);
      }
    } catch (error: any) {
      this.logger.error(
        `Error MQTT al notificar tratamiento ${treatmentId}: ${error.message}`,
      );
    }
  }
}
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { CreateTreatmentDetailDto, UpdateTreatmentDetailDto } from './dto/treatment-detail.dto';
import { parseDateOnly } from '../../common/timezone';

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

    const [h, m] = (dto.firstTakeTime || '08:00').split(':').map(Number);
    const detail = await this.prisma.treatment_details.create({
      data: {
        treatment_id: dto.treatmentId,
        medication_id: dto.medicationId,
        dose_info: dto.doseInfo ?? null,
        frequency_hours: dto.frequencyHours ?? 1,
        first_take_time: new Date(1970, 0, 1, h || 8, m || 0, 0, 0),
        end_date: dto.endDate ? parseDateOnly(dto.endDate) : null,
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

  async update(id: number, dto: UpdateTreatmentDetailDto) {
    const detail = await this.prisma.treatment_details.findFirst({
      where: { id, deleted_at: null },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de tratamiento no encontrado');
    }

    const updated = await this.prisma.treatment_details.update({
      where: { id },
      data: {
        ...(dto.medicationId !== undefined && { medication_id: dto.medicationId }),
        ...(dto.doseInfo !== undefined && { dose_info: dto.doseInfo }),
        ...(dto.frequencyHours !== undefined && { frequency_hours: dto.frequencyHours }),
        ...(dto.firstTakeTime !== undefined && { first_take_time: (() => { const [hh, mm] = dto.firstTakeTime!.split(':').map(Number); return new Date(1970, 0, 1, hh, mm, 0, 0); })() }),
        ...(dto.endDate !== undefined && { end_date: dto.endDate ? parseDateOnly(dto.endDate) : null }),
        ...(dto.compartmentNumber !== undefined && { compartment_number: dto.compartmentNumber }),
        ...(dto.isExternal !== undefined && { is_external: dto.isExternal }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: { medications: true },
    });

    await this.recalculateTreatmentEndDate(detail.treatment_id);
    await this.notifyDeviceByTreatment(detail.treatment_id);

    return updated;
  }

  private async recalculateTreatmentEndDate(treatmentId: number) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id: treatmentId, deleted_at: null },
    });
    if (!treatment) return;

    const detailsWithEnd = await this.prisma.treatment_details.findMany({
      where: { treatment_id: treatmentId, deleted_at: null, end_date: { not: null } },
      select: { end_date: true },
    });

    const maxDetailDate =
      detailsWithEnd.length === 0
        ? null
        : detailsWithEnd
            .map((d) => d.end_date as Date)
            .sort((a, b) => b.getTime() - a.getTime())[0];

    // Si no hay ningún detalle con end_date, el tratamiento queda como crónico (null).
    // Si hay max, sincroniza el tratamiento al max más lejano (cubre creación, extensión y reducción).
    if (maxDetailDate === null) {
      // Solo limpia si el tratamiento actualmente tenía fecha derivada (no hay detalles con fecha -> crónico)
      // Para evitar pisar una fecha explícita del usuario cuando todos los detalles son crónicos,
      // igualmente lo ponemos a null porque el requisito pide que si todos los detalles son null, tratamiento null.
      // Si el usuario quiere una fecha explícita distinta, deberá setearla vía PATCH /treatments.
      if (treatment.end_date !== null) {
        // Si hay detalles sin fecha, el max es null -> tratamiento crónico
        // Se mantiene null solo si el usuario no tiene una fecha explícita que quiera conservar;
        // aquí sincronizamos a null para reflejar que no hay duración definida.
        // Si se quiere preservar una fecha explícita aunque detalles sean null, comentar este bloque.
        const activeDetailsCount = await this.prisma.treatment_details.count({
          where: { treatment_id: treatmentId, deleted_at: null },
        });
        // Si hay detalles pero ninguno con end_date, lo dejamos en null (crónico)
        if (activeDetailsCount > 0) {
          await this.prisma.treatments.update({
            where: { id: treatmentId },
            data: { end_date: null },
          });
          this.logger.log(`Tratamiento ${treatmentId} recalculado a null (crónico) - ${activeDetailsCount} detalles sin fecha fin`);
        }
      }
      return;
    }

    // Hay al menos un detalle con fecha: sincroniza al max (sea extensión, primera asignación o reducción)
    const current = treatment.end_date ? new Date(treatment.end_date).getTime() : null;
    const next = maxDetailDate.getTime();
    if (current === null || current !== next) {
      await this.prisma.treatments.update({
        where: { id: treatmentId },
        data: { end_date: maxDetailDate },
      });
      const action = current === null ? 'auto-calculado' : current < next ? 'extendido' : 'reducido';
      this.logger.log(`Tratamiento ${treatmentId} ${action} a ${maxDetailDate.toISOString().slice(0, 10)} (max de ${detailsWithEnd.length} detalles)`);
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

    // Recalcula siempre al max restante (cubre borrado del max y borrado de secundarios)
    await this.recalculateTreatmentEndDate(detail.treatment_id);

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
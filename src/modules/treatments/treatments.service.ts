import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTreatmentDto, UpdateTreatmentDto } from './dto/treatment.dto';

@Injectable()
export class TreatmentsService {
  private readonly logger = new Logger(TreatmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: DevicesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findByPatient(patientId: number) {
    return this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          include: {
            medications: true,
            schedules: {
              where: { deleted_at: null },
              include: { medication_logs: { where: { deleted_at: null } } },
            },
          },
        },
      },
    });
  }

  async findActive(patientId: number) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { patient_id: patientId, status: 'Activo', deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          include: {
            medications: true,
            schedules: {
              where: { deleted_at: null },
              include: { medication_logs: { where: { deleted_at: null } } },
            },
          },
        },
      },
    });

    if (!treatment) {
      throw new NotFoundException('No hay tratamiento activo para este paciente');
    }

    return treatment;
  }

  async create(dto: CreateTreatmentDto) {
    const patient = await this.prisma.patients.findFirst({
      where: { id: dto.patientId, deleted_at: null },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    const treatment = await this.prisma.treatments.create({
      data: {
        patient_id: dto.patientId,
        start_date: new Date(dto.startDate),
        end_date: dto.endDate ? new Date(dto.endDate) : null,
        status: dto.status ?? 'Activo',
      },
    });

    await this.notifyDeviceConfig(dto.patientId);

    return treatment;
  }

  async update(id: number, dto: UpdateTreatmentDto) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id, deleted_at: null },
    });
    if (!treatment) {
      throw new NotFoundException('Tratamiento no encontrado');
    }

    // Si se solicita finalizar, delega a finalize() para liberar compartimentos y notificar
    if (dto.status === 'Finalizado') {
      return this.finalize(id);
    }

    const updatedTreatment = await this.prisma.treatments.update({
      where: { id },
      data: {
        ...(dto.endDate !== undefined && { end_date: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    await this.notifyDeviceConfig(treatment.patient_id);

    return updatedTreatment;
  }

  async finalize(id: number) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id, deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          select: { id: true, compartment_number: true },
        },
      },
    });
    if (!treatment) {
      throw new NotFoundException('Tratamiento no encontrado');
    }
    if (treatment.status === 'Finalizado') {
      throw new BadRequestException('El tratamiento ya está finalizado');
    }

    const now = new Date();

    // 1. Marca tratamiento como Finalizado
    const finalized = await this.prisma.treatments.update({
      where: { id },
      data: { status: 'Finalizado' },
    });

    // 2. Marca todos los detalles como Finalizado
    await this.prisma.treatment_details.updateMany({
      where: { treatment_id: id, deleted_at: null },
      data: { status: 'Finalizado' },
    });

    // 3. Libera compartimentos del pastillero (status -> closed)
    await this.releaseCompartments(treatment.patient_id, treatment.treatment_details);

    // 4. Actualiza MQTT: al excluir status != Activo, el config ya no incluirá este tratamiento
    await this.notifyDeviceConfig(treatment.patient_id);

    // 5. Notifica a cuidadores
    try {
      const profileIds = await this.notificationsService.caregiverProfilesForPatient(treatment.patient_id);
      for (const pid of profileIds) {
        await this.notificationsService.createAndPush(pid, {
          title: 'Tratamiento finalizado',
          message: `El tratamiento #${id} ha finalizado y los compartimentos fueron liberados.`,
          type: 'SISTEMA',
          patientId: treatment.patient_id,
          route: 'treatment',
          metadata: { treatment_id: id } as any,
        });
      }
    } catch (e: any) {
      this.logger.warn(`No se pudo notificar finalización tratamiento ${id}: ${e.message}`);
    }

    this.logger.log(`Tratamiento ${id} finalizado manualmente, ${treatment.treatment_details.length} detalles -> Finalizado, compartimentos liberados`);

    return finalized;
  }

  private async releaseCompartments(
    patientId: number,
    details: Array<{ compartment_number: number | null }>,
  ) {
    const device = await this.prisma.devices.findFirst({
      where: { patient_id: patientId, deleted_at: null },
    });
    if (!device) return;

    const compartments = [...new Set(details.map((d) => d.compartment_number).filter((n): n is number => n != null))];
    if (compartments.length === 0) return;

    for (const num of compartments) {
      const comp = await this.prisma.device_compartments.findFirst({
        where: { device_id: device.id, compartment_number: num, deleted_at: null },
      });
      if (comp) {
        await this.prisma.device_compartments.update({
          where: { id: comp.id },
          data: { status: 'closed' as any },
        });
      }
    }
    this.logger.log(`Compartimentos liberados para paciente ${patientId}: ${compartments.join(', ')}`);
  }

  async remove(id: number) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id, deleted_at: null },
    });
    if (!treatment) {
      throw new NotFoundException('Tratamiento no encontrado');
    }

    const now = new Date();

    // Soft-delete tratamiento
    await this.prisma.treatments.update({
      where: { id },
      data: { deleted_at: now },
    });

    // Soft-delete cascada: detalles -> horarios -> logs
    const details = await this.prisma.treatment_details.findMany({
      where: { treatment_id: id, deleted_at: null },
      select: { id: true },
    });

    if (details.length > 0) {
      const detailIds = details.map((d) => d.id);
      await this.prisma.treatment_details.updateMany({
        where: { id: { in: detailIds } },
        data: { deleted_at: now },
      });

      const schedules = await this.prisma.schedules.findMany({
        where: { treatment_detail_id: { in: detailIds }, deleted_at: null },
        select: { id: true },
      });

      if (schedules.length > 0) {
        const scheduleIds = schedules.map((s) => s.id);
        await this.prisma.schedules.updateMany({
          where: { id: { in: scheduleIds } },
          data: { deleted_at: now },
        });
        await this.prisma.medication_logs.updateMany({
          where: { schedule_id: { in: scheduleIds }, deleted_at: null },
          data: { deleted_at: now },
        });
      }
    }

    await this.notifyDeviceConfig(treatment.patient_id);

    return { message: 'Tratamiento eliminado exitosamente' };
  }

  private async notifyDeviceConfig(patientId: number): Promise<void> {
    try {
      const device = await this.prisma.devices.findFirst({
        where: { patient_id: patientId, deleted_at: null },
      });

      if (device) {
        await this.devicesService.sendConfigToDevice(device.unique_code, patientId);
      }
    } catch (error: any) {
      this.logger.error(
        `Error al enviar configuración MQTT al dispositivo del paciente ${patientId}: ${error.message}`,
      );
    }
  }
}
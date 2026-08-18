import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateMedicationLogDto,
  UpdateMedicationLogDto,
} from './dto/medication-log.dto';

@Injectable()
export class MedicationLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findRecent(patientId: number) {
    const treatments = await this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      select: { id: true },
    });
    const treatmentIds = treatments.map((t) => t.id);

    const details = await this.prisma.treatment_details.findMany({
      where: { treatment_id: { in: treatmentIds }, deleted_at: null },
      select: { id: true },
    });
    const detailIds = details.map((d) => d.id);

    const schedules = await this.prisma.schedules.findMany({
      where: { treatment_detail_id: { in: detailIds }, deleted_at: null },
      select: { id: true },
    });
    const scheduleIds = schedules.map((s) => s.id);

    return this.prisma.medication_logs.findMany({
      where: { schedule_id: { in: scheduleIds }, deleted_at: null },
      orderBy: { scheduled_datetime: 'desc' },
      take: 50,
    });
  }

  async getAdherence(patientId: number) {
    const treatments = await this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      select: { id: true },
    });
    const treatmentIds = treatments.map((t) => t.id);

    const details = await this.prisma.treatment_details.findMany({
      where: { treatment_id: { in: treatmentIds }, deleted_at: null },
      select: { id: true },
    });
    const detailIds = details.map((d) => d.id);

    const schedules = await this.prisma.schedules.findMany({
      where: { treatment_detail_id: { in: detailIds }, deleted_at: null },
      select: { id: true },
    });
    const scheduleIds = schedules.map((s) => s.id);

    const total = await this.prisma.medication_logs.count({
      where: { schedule_id: { in: scheduleIds }, deleted_at: null },
    });
    const completed = await this.prisma.medication_logs.count({
      where: { schedule_id: { in: scheduleIds }, status: 'Confirmado', deleted_at: null },
    });

    if (total === 0) return { adherence: 1.0, total, completed };
    return { adherence: +(completed / total).toFixed(2), total, completed };
  }

  async create(dto: CreateMedicationLogDto, vitalId?: string) {
    const schedule = await this.prisma.schedules.findFirst({
      where: { id: dto.scheduleId, deleted_at: null },
      include: {
        treatment_details: {
          include: { treatments: true, medications: true },
        },
      },
    });
    if (!schedule) {
      throw new NotFoundException('Schedule no encontrado');
    }

    const log = await this.prisma.medication_logs.create({
      data: {
        schedule_id: dto.scheduleId,
        scheduled_datetime: new Date(dto.scheduledDatetime),
        actual_taken_datetime: dto.actualTakenDatetime
          ? new Date(dto.actualTakenDatetime)
          : null,
        status: dto.status ?? 'Pendiente',
        voice_confirmed: dto.voiceConfirmed ?? false,
      },
    });

    if ((dto.status ?? 'Pendiente') === 'Confirmado') {
      await this.notifyDoseConfirmed(schedule, vitalId);
    }

    return log;
  }

  async update(id: number, dto: UpdateMedicationLogDto, vitalId?: string) {
    const log = await this.prisma.medication_logs.findFirst({
      where: { id, deleted_at: null },
    });
    if (!log) {
      throw new NotFoundException('Medication log no encontrado');
    }

    const updated = await this.prisma.medication_logs.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.actualTakenDatetime !== undefined && {
          actual_taken_datetime: new Date(dto.actualTakenDatetime),
        }),
        ...(dto.voiceConfirmed !== undefined && {
          voice_confirmed: dto.voiceConfirmed,
        }),
      },
    });

    // Notificar solo en la transición a Confirmado (evita duplicados)
    if (dto.status === 'Confirmado' && log.status !== 'Confirmado') {
      const schedule = await this.prisma.schedules.findFirst({
        where: { id: log.schedule_id, deleted_at: null },
        include: {
          treatment_details: {
            include: { treatments: true, medications: true },
          },
        },
      });
      if (schedule) {
        await this.notifyDoseConfirmed(schedule, vitalId);
      }
    }

    return updated;
  }

  private async notifyDoseConfirmed(
    schedule: {
      treatment_details: {
        treatments: { patient_id: number };
        medications: { name: string };
      };
    },
    vitalId?: string,
  ) {
    const detail = schedule.treatment_details;
    const patientId = detail.treatments.patient_id;
    const medName = detail.medications.name;

    // Excluir al actor (si es cuidador confirmando en nombre del paciente)
    let actorProfileId: number | undefined;
    if (vitalId) {
      const actorProfile = await this.prisma.app_profiles.findFirst({
        where: { vital_id: vitalId, deleted_at: null },
        select: { id: true },
      });
      actorProfileId = actorProfile?.id;
    }

    const profiles = await this.notificationsService.caregiverProfilesForPatient(
      patientId,
      actorProfileId,
    );
    for (const profileId of profiles) {
      await this.notificationsService.createAndPush(profileId, {
        title: 'Dosis confirmada',
        message: `La dosis de ${medName} fue confirmada.`,
        type: 'DOSIS_RECORDATORIO',
        patientId,
        route: 'schedule',
      });
    }
  }
}

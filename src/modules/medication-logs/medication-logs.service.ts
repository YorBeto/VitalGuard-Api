import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMedicationLogDto,
  UpdateMedicationLogDto,
} from './dto/medication-log.dto';

@Injectable()
export class MedicationLogsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(dto: CreateMedicationLogDto) {
    const schedule = await this.prisma.schedules.findFirst({
      where: { id: dto.scheduleId, deleted_at: null },
    });
    if (!schedule) {
      throw new NotFoundException('Schedule no encontrado');
    }

    return this.prisma.medication_logs.create({
      data: {
        schedule_id: dto.scheduleId,
        scheduled_datetime: new Date(dto.scheduledDatetime),
        status: 'Pendiente',
      },
    });
  }

  async update(id: number, dto: UpdateMedicationLogDto) {
    const log = await this.prisma.medication_logs.findFirst({
      where: { id, deleted_at: null },
    });
    if (!log) {
      throw new NotFoundException('Medication log no encontrado');
    }

    return this.prisma.medication_logs.update({
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
  }
}

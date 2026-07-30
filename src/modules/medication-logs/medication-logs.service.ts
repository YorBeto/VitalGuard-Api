import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
}

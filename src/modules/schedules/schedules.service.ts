import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findToday(patientId: number) {
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
}

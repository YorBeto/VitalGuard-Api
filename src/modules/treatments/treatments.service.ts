import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TreatmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPatient(patientId: number) {
    return this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          include: { medications: true },
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
          include: { medications: true },
        },
      },
    });

    if (!treatment) {
      throw new NotFoundException('No hay tratamiento activo para este paciente');
    }

    return treatment;
  }
}

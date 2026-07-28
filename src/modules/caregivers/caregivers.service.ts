import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CaregiversService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPatient(patientId: number) {
    const relations = await this.prisma.caregiver_patient.findMany({
      where: { patient_id: patientId, deleted_at: null },
      include: {
        caregivers: {
          include: {
            app_profiles: true,
          },
        },
      },
    });

    return relations.map((r) => ({
      ...r.caregivers,
      kinship: r.kinship,
    }));
  }
}

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

    return relations.map((r) => {
      const vitalId: string | null = (r.caregivers as any)?.app_profiles?.vital_id ?? null;
      const kinshipRaw = r.kinship as string | null;
      let kinshipDisplay = kinshipRaw
        ? kinshipRaw.replace('Hijo_a', 'Hijo/a').replace('Abuelo_a', 'Abuelo/a').replace('Esposo_a', 'Esposo/a')
        : null;

      return {
        ...r.caregivers,
        kinship: r.kinship,
        kinshipDisplay,
        vitalId,
        displayName: null,
      };
    });
  }

  async updatePriority(caregiverId: number, priority: number) {
    return this.prisma.caregivers.update({
      where: { id: caregiverId },
      data: { emergency_call_priority: priority },
    });
  }
}

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

    // Intenta resolver nombre display: si el caregiver tiene un paciente autocuidado, usa ese nombre
    const caregiverIds = relations.map((r) => r.caregivers.id);
    const selfPatients = caregiverIds.length
      ? await this.prisma.caregiver_patient.findMany({
          where: { caregiver_id: { in: caregiverIds }, deleted_at: null },
          include: { patients: { select: { first_name: true, paternal_last_name: true, maternal_last_name: true } } },
        })
      : [];

    const selfMap = new Map<number, string>();
    for (const sp of selfPatients) {
      if (!selfMap.has(sp.caregiver_id) && sp.patients) {
        const p = sp.patients;
        const name = [p.first_name, p.paternal_last_name, p.maternal_last_name].filter(Boolean).join(' ');
        if (name) selfMap.set(sp.caregiver_id, name);
      }
    }

    return relations.map((r) => {
      const vitalId: string | null = (r.caregivers as any)?.app_profiles?.vital_id ?? null;
      const kinshipRaw = r.kinship as string | null;
      const kinshipDisplay = kinshipRaw
        ? kinshipRaw.replace('Hijo_a', 'Hijo/a').replace('Abuelo_a', 'Abuelo/a').replace('Esposo_a', 'Esposo/a')
        : null;
      return {
        ...r.caregivers,
        kinship: r.kinship,
        kinshipDisplay,
        vitalId,
        displayName: selfMap.get(r.caregivers.id) ?? null,
      };
    });
  }
}

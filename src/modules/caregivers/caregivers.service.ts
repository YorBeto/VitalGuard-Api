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

    // Resuelve nombre del paciente consultado para detectar autocuidado (caregiver == paciente)
    const viewedPatient = relations.length
      ? await this.prisma.patients.findUnique({
          where: { id: patientId },
          select: { first_name: true, paternal_last_name: true, maternal_last_name: true },
        })
      : null;
    const viewedName = viewedPatient
      ? [viewedPatient.first_name, viewedPatient.paternal_last_name, viewedPatient.maternal_last_name].filter(Boolean).join(' ')
      : null;

    return relations.map((r) => {
      const vitalId: string | null = (r.caregivers as any)?.app_profiles?.vital_id ?? null;
      const kinshipRaw = r.kinship as string | null;
      let kinshipDisplay = kinshipRaw
        ? kinshipRaw.replace('Hijo_a', 'Hijo/a').replace('Abuelo_a', 'Abuelo/a').replace('Esposo_a', 'Esposo/a')
        : null;
      const disp = selfMap.get(r.caregivers.id) ?? null;
      // Si es autocuidado (displayName coincide con paciente visto y kinship Otro), etiqueta como Autocuidado
      if (kinshipRaw === 'Otro' && disp && viewedName && disp === viewedName) {
        kinshipDisplay = 'Autocuidado';
      }
      return {
        ...r.caregivers,
        kinship: r.kinship,
        kinshipDisplay,
        vitalId,
        displayName: disp,
      };
    });
  }
}

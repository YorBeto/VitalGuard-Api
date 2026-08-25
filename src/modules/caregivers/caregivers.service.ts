import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/services/patient-access.service';

@Injectable()
export class CaregiversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findByPatient(vitalId: string, patientId: number) {
    await this.patientAccess.assertHasAccessToPatient(vitalId, patientId);
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

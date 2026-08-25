import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PatientAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica que el usuario autenticado (por vitalId) tenga una relación activa
   * de cuidador o médico con el paciente indicado. Lanza ForbiddenException si no.
   */
  async assertHasAccessToPatient(
    vitalId: string,
    patientId: number,
  ): Promise<void> {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) {
      throw new ForbiddenException('No tienes acceso a este paciente');
    }

    const [caregiver, doctor] = await Promise.all([
      this.prisma.caregivers.findFirst({
        where: { app_profile_id: appProfile.id, deleted_at: null },
      }),
      this.prisma.doctors.findFirst({
        where: { app_profile_id: appProfile.id, deleted_at: null },
      }),
    ]);

    if (caregiver) {
      const relation = await this.prisma.caregiver_patient.findFirst({
        where: {
          caregiver_id: caregiver.id,
          patient_id: patientId,
          deleted_at: null,
        },
      });
      if (relation) return;
    }

    if (doctor) {
      const relation = await this.prisma.doctor_patient.findFirst({
        where: {
          doctor_id: doctor.id,
          patient_id: patientId,
          deleted_at: null,
        },
      });
      if (relation) return;
    }

    throw new ForbiddenException('No tienes acceso a este paciente');
  }
}

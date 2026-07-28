import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByCaregiver(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });

    if (!appProfile) return [];

    const caregiver = await this.prisma.caregivers.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });

    if (!caregiver) return [];

    const relations = await this.prisma.caregiver_patient.findMany({
      where: { caregiver_id: caregiver.id, deleted_at: null },
      include: { patients: true },
    });

    return relations.map((r) => r.patients);
  }

  async findOne(id: number) {
    const patient = await this.prisma.patients.findFirst({
      where: { id, deleted_at: null },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    return patient;
  }
}

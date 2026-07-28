import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DoctorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPatient(patientId: number) {
    const relations = await this.prisma.doctor_patient.findMany({
      where: { patient_id: patientId, deleted_at: null },
      include: { doctors: { include: { app_profiles: true } } },
    });

    return relations.map((r) => r.doctors);
  }
}

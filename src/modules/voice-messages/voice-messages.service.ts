import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/services/patient-access.service';

@Injectable()
export class VoiceMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findByPatient(vitalId: string, patientId: number) {
    await this.patientAccess.assertHasAccessToPatient(vitalId, patientId);
    return this.prisma.voice_messages.findMany({
      where: { patient_id: patientId },
      orderBy: { created_at: 'desc' },
    });
  }
}

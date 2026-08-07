import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VoiceMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPatient(patientId: number) {
    return this.prisma.voice_messages.findMany({
      where: { patient_id: patientId },
      orderBy: { created_at: 'desc' },
    });
  }
}

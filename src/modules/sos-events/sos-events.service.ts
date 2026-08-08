import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SosEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(patientId: number) {
    return this.prisma.sos_events.findMany({
      where: { patient_id: patientId, status: 'Activo' },
    });
  }

  async create(patientId: number) {
    return this.prisma.sos_events.create({
      data: {
        patient_id: patientId,
        status: 'Activo',
      },
    });
  }
}

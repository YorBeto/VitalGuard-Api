import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MedicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.medications.findMany({
      where: { deleted_at: null },
    });
  }

  async findOne(id: number) {
    return this.prisma.medications.findFirst({
      where: { id, deleted_at: null },
    });
  }
}

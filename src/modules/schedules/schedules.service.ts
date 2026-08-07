import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateScheduleDto } from './dto/schedule.dto';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findToday(patientId: number) {
    const treatments = await this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      select: { id: true },
    });

    const treatmentIds = treatments.map((t) => t.id);

    return this.prisma.schedules.findMany({
      where: {
        treatment_details: {
          treatment_id: { in: treatmentIds },
          deleted_at: null,
        },
        deleted_at: null,
      },
      include: {
        treatment_details: {
          include: { medications: true },
        },
      },
    });
  }

  async create(dto: CreateScheduleDto) {
    const detail = await this.prisma.treatment_details.findFirst({
      where: { id: dto.treatmentDetailId, deleted_at: null },
    });
    if (!detail) {
      throw new NotFoundException('Treatment detail no encontrado');
    }

    return this.prisma.schedules.create({
      data: {
        treatment_detail_id: dto.treatmentDetailId,
        time_of_day: new Date(`1970-01-01T${dto.timeOfDay}`),
      },
    });
  }

  async remove(id: number) {
    const schedule = await this.prisma.schedules.findFirst({
      where: { id, deleted_at: null },
    });
    if (!schedule) {
      throw new NotFoundException('Horario no encontrado');
    }

    await this.prisma.schedules.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { message: 'Horario eliminado exitosamente' };
  }
}

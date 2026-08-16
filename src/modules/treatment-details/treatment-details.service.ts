import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTreatmentDetailDto } from './dto/treatment-detail.dto';

@Injectable()
export class TreatmentDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByTreatment(treatmentId: number) {
    return this.prisma.treatment_details.findMany({
      where: { treatment_id: treatmentId, deleted_at: null },
      include: {
        medications: true,
        schedules: { where: { deleted_at: null } },
      },
    });
  }

  async create(dto: CreateTreatmentDetailDto) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id: dto.treatmentId, deleted_at: null },
    });
    if (!treatment) {
      throw new NotFoundException('Tratamiento no encontrado');
    }

    const medication = await this.prisma.medications.findFirst({
      where: { id: dto.medicationId, deleted_at: null },
    });
    if (!medication) {
      throw new NotFoundException('Medicamento no encontrado');
    }

    return this.prisma.treatment_details.create({
      data: {
        treatment_id: dto.treatmentId,
        medication_id: dto.medicationId,
        dose_info: dto.doseInfo ?? null,
        frequency_hours: dto.frequencyHours ?? 1,
        first_take_time: new Date(`1970-01-01T${dto.firstTakeTime}`),
        end_date: dto.endDate ? new Date(dto.endDate) : null,
        compartment_number: dto.compartmentNumber ?? null,
        is_external: dto.isExternal ?? false,
        status: dto.status ?? 'En_curso',
      },
      include: { medications: true },
    });
  }

  async remove(id: number) {
    const detail = await this.prisma.treatment_details.findFirst({
      where: { id, deleted_at: null },
    });
    if (!detail) {
      throw new NotFoundException('Detalle de tratamiento no encontrado');
    }

    await this.prisma.treatment_details.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { message: 'Detalle de tratamiento eliminado exitosamente' };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTreatmentDto, UpdateTreatmentDto } from './dto/treatment.dto';

@Injectable()
export class TreatmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPatient(patientId: number) {
    return this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          include: {
            medications: true,
            schedules: { where: { deleted_at: null } },
          },
        },
      },
    });
  }

  async findActive(patientId: number) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { patient_id: patientId, status: 'Activo', deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          include: {
            medications: true,
            schedules: { where: { deleted_at: null } },
          },
        },
      },
    });

    if (!treatment) {
      throw new NotFoundException('No hay tratamiento activo para este paciente');
    }

    return treatment;
  }

  async create(dto: CreateTreatmentDto) {
    const patient = await this.prisma.patients.findFirst({
      where: { id: dto.patientId, deleted_at: null },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    return this.prisma.treatments.create({
      data: {
        patient_id: dto.patientId,
        start_date: new Date(dto.startDate),
        end_date: dto.endDate ? new Date(dto.endDate) : null,
        status: dto.status ?? 'Activo',
      },
    });
  }

  async update(id: number, dto: UpdateTreatmentDto) {
    const treatment = await this.prisma.treatments.findFirst({
      where: { id, deleted_at: null },
    });
    if (!treatment) {
      throw new NotFoundException('Tratamiento no encontrado');
    }

    return this.prisma.treatments.update({
      where: { id },
      data: {
        ...(dto.endDate !== undefined && { end_date: new Date(dto.endDate) }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }
}

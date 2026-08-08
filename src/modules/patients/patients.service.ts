import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getCaregiverByVitalId(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) return null;

    return this.prisma.caregivers.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
  }

  private async assertPatientBelongsToCaregiver(
    patientId: number,
    vitalId: string,
  ): Promise<void> {
    const caregiver = await this.getCaregiverByVitalId(vitalId);
    if (!caregiver) {
      throw new ForbiddenException('No tienes un perfil de cuidador activo');
    }

    const relation = await this.prisma.caregiver_patient.findFirst({
      where: {
        caregiver_id: caregiver.id,
        patient_id: patientId,
        deleted_at: null,
      },
    });

    if (!relation) {
      throw new ForbiddenException('No tienes acceso a este paciente');
    }
  }

  async findAllByCaregiver(vitalId: string, query: PaginationQueryDto) {
    const caregiver = await this.getCaregiverByVitalId(vitalId);
    if (!caregiver) {
      throw new NotFoundException('Perfil de cuidador no encontrado');
    }

    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const [relations, total] = await Promise.all([
      this.prisma.caregiver_patient.findMany({
        where: { caregiver_id: caregiver.id, deleted_at: null },
        include: {
          patients: {
            include: {
              devices: true,
              treatments: {
                where: { status: 'Activo', deleted_at: null },
                take: 1,
              },
            },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.caregiver_patient.count({
        where: { caregiver_id: caregiver.id, deleted_at: null },
      }),
    ]);

    return {
      data: relations.map((r) => ({
        ...r.patients,
        kinship: r.kinship,
      })),
      meta: { page, limit, total },
    };
  }

  async findOne(id: number, vitalId: string) {
    await this.assertPatientBelongsToCaregiver(id, vitalId);

    const patient = await this.prisma.patients.findFirst({
      where: { id, deleted_at: null },
      include: {
        devices: true,
        treatments: {
          where: { status: 'Activo', deleted_at: null },
          take: 1,
          include: {
            treatment_details: {
              where: { deleted_at: null },
              include: { medications: true },
            },
          },
        },
        doctor_patient: {
          where: { deleted_at: null },
          include: { doctors: { include: { app_profiles: true } } },
        },
      },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    return patient;
  }

  async create(vitalId: string, dto: CreatePatientDto) {
    const caregiver = await this.getCaregiverByVitalId(vitalId);
    if (!caregiver) {
      throw new NotFoundException('Perfil de cuidador no encontrado');
    }

    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patients.create({
        data: {
          first_name: dto.firstName,
          paternal_last_name: dto.paternalLastName,
          maternal_last_name: dto.maternalLastName ?? null,
          birth_date: new Date(dto.birthDate),
          gender: dto.gender,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
          blood_type: dto.bloodType ?? null,
          medical_notes: dto.medicalNotes ?? null,
        },
      });

      await tx.caregiver_patient.create({
        data: {
          caregiver_id: caregiver.id,
          patient_id: patient.id,
          kinship: 'Otro',
        },
      });

      return patient;
    });
  }

  async update(id: number, vitalId: string, dto: UpdatePatientDto) {
    await this.assertPatientBelongsToCaregiver(id, vitalId);

    const patient = await this.prisma.patients.findFirst({
      where: { id, deleted_at: null },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    return this.prisma.patients.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined && { first_name: dto.firstName }),
        ...(dto.paternalLastName !== undefined && {
          paternal_last_name: dto.paternalLastName,
        }),
        ...(dto.maternalLastName !== undefined && {
          maternal_last_name: dto.maternalLastName,
        }),
        ...(dto.birthDate !== undefined && {
          birth_date: new Date(dto.birthDate),
        }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.bloodType !== undefined && { blood_type: dto.bloodType }),
        ...(dto.medicalNotes !== undefined && {
          medical_notes: dto.medicalNotes,
        }),
      },
    });
  }

  async remove(id: number, vitalId: string) {
    await this.assertPatientBelongsToCaregiver(id, vitalId);

    const patient = await this.prisma.patients.findFirst({
      where: { id, deleted_at: null },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    await this.prisma.patients.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { message: 'Paciente eliminado exitosamente' };
  }
}

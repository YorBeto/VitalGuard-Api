import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OnboardingDto, OnboardingRole } from './dto/create-onboarding.dto';
import { gender_type, blood_type } from '@prisma/client';

@Injectable()
export class AppProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async completeOnboarding(vitalId: string, jwtUser: any, dto: OnboardingDto) {
    // 1. Validar que el usuario no tenga ya un perfil registrado
    const existingProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });

    if (existingProfile) {
      throw new ConflictException('El usuario ya completó el onboarding previamente');
    }

    // 2. Transacción de Prisma para garantizar atomicidad
    return await this.prisma.$transaction(async (tx) => {
      // 💡 En la App Móvil, la persona que opera la app SIEMPRE es CAREGIVER
      const caregiverRole = await tx.roles.findFirst({
        where: { name: 'CAREGIVER', app_name: 'MOBILE', deleted_at: null },
      });

      if (!caregiverRole) {
        throw new NotFoundException('El rol CAREGIVER para MOBILE no está configurado en la base de datos');
      }

      // Crear el perfil de app SIEMPRE como CAREGIVER
      const appProfile = await tx.app_profiles.create({
        data: {
          vital_id: vitalId,
          role_id: caregiverRole.id,
          is_active: true,
        },
      });

      // Crear SIEMPRE el registro en la tabla caregivers
      const caregiver = await tx.caregivers.create({
        data: {
          app_profile_id: appProfile.id,
          emergency_call_priority: 1,
        },
      });

      // CASO A: Autocuidado (PATIENT)
      if (dto.role === OnboardingRole.PATIENT) {
        const firstName = dto.patientData?.firstName || jwtUser?.firstName || jwtUser?.first_name;
        const paternalLastName = dto.patientData?.paternalLastName || jwtUser?.paternalLastName || jwtUser?.paternal_last_name;
        const maternalLastName = dto.patientData?.maternalLastName || jwtUser?.maternalLastName || jwtUser?.maternal_last_name;
        const birthDate = dto.patientData?.birthDate ? new Date(dto.patientData.birthDate) : new Date('2000-01-01');
        const gender = (dto.patientData?.gender || 'M') as gender_type;

        if (!firstName || !paternalLastName) {
          throw new BadRequestException('Faltan el nombre y apellido paterno del paciente');
        }

        // Crear el registro clínico del paciente
        const patient = await tx.patients.create({
          data: {
            first_name: firstName,
            paternal_last_name: paternalLastName,
            maternal_last_name: maternalLastName || null,
            birth_date: birthDate,
            gender: gender,
            blood_type: (dto.patientData?.bloodType as blood_type) || null,
            medical_notes: dto.patientData?.medicalNotes || null,
          },
        });

        // Vincular en caregiver_patient (Cuidador de sí mismo / Autocuidado)
        await tx.caregiver_patient.create({
          data: {
            caregiver_id: caregiver.id,
            patient_id: patient.id,
            kinship: dto.kinship || 'Otro',
          },
        });

        return {
          message: 'Onboarding completado exitosamente (Modo Autocuidado)',
          appProfileId: appProfile.id,
          caregiverId: caregiver.id,
          patientId: patient.id,
          isSelfCare: true,
        };
      }

      // CASO B: Cuidador Puro (Cuidar a alguien más)
      return {
        message: 'Onboarding completado exitosamente como Cuidador',
        appProfileId: appProfile.id,
        caregiverId: caregiver.id,
        isSelfCare: false,
      };
    });
  }
}
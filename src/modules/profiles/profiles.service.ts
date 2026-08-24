import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) { }

  async checkProfileStatus(vitalId: string) {
    // 1. Buscamos el perfil usando el UUID que nos mande el SSO
    const profile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId }
    });

    // 2. Si no tiene perfil en Vital Guard, está incompleto
    if (!profile) {
      return { hasProfile: false, isComplete: false };
    }

    // 3. Consultamos directamente la tabla doctors por app_profile_id
    const doctorData = await this.prisma.doctors.findFirst({
      where: { app_profile_id: profile.id }
    });

    const isComplete = Boolean(doctorData && doctorData.medical_license && doctorData.specialty);

    return {
      hasProfile: true,
      isComplete,
      roleId: profile.role_id,
      data: doctorData
    };
  }

  async completeDoctorProfile(vitalId: string, specialty: string, medicalLicense: string) {
    // 1. Buscar si el usuario ya tiene un perfil base en Vital Guard
    let profile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId }
    });

    // 2. Si no tiene perfil, lo creamos buscando el rol de Doctor dinámicamente
    if (!profile) {
      const doctorRole = await this.prisma.roles.findFirst({
        where: { name: 'Doctor' }
      });

      if (!doctorRole) {
        throw new Error('El rol de Doctor no está configurado en la base de datos.');
      }

      profile = await this.prisma.app_profiles.create({
        data: {
          vital_id: vitalId,
          role_id: doctorRole.id, // Asigna el ID correcto encontrado en la BD
          is_active: true
        }
      });
    }

    // 3. Revisar si ya tiene un registro en la tabla doctors
    const existingDoctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: profile.id }
    });

    // 4. Actualizar o crear sus datos médicos
    if (existingDoctor) {
      return await this.prisma.doctors.update({
        where: { id: existingDoctor.id },
        data: { specialty, medical_license: medicalLicense }
      });
    } else {
      return await this.prisma.doctors.create({
        data: {
          app_profile_id: profile.id,
          specialty,
          medical_license: medicalLicense
        }
      });
    }
  }
}
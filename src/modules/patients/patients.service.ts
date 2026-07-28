import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';


@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPatient(vitalId: string, dto: CreatePatientDto) {
    // 1. Buscar el app_profile activo del usuario autenticado
        const appProfile = await this.prisma.app_profiles.findFirst({
        where: { vital_id: vitalId, deleted_at: null },
        include: { caregivers: true },
        });

        if (!appProfile) {
        throw new NotFoundException('No se encontró un perfil activo para este usuario.');
        }

        // 2. Obtener la entidad de cuidador (Relación 1 a 1 en Prisma)
        const caregiver = appProfile.caregivers;

        if (!caregiver) {
        throw new BadRequestException('El usuario autenticado no cuenta con perfil de Cuidador.');
        }

    // 3. Transacción para crear al paciente y la relación caregiver_patient
    return await this.prisma.$transaction(async (tx) => {
      // A) Crear el registro clínico del paciente
      const patient = await tx.patients.create({
        data: {
          first_name: dto.firstName,
          paternal_last_name: dto.paternalLastName,
          maternal_last_name: dto.maternalLastName || null,
          birth_date: new Date(dto.birthDate),
          gender: dto.gender,
          blood_type: dto.bloodType || null,
          medical_notes: dto.medicalNotes || null,
        },
      });

      // B) Crear el vínculo en caregiver_patient
      const link = await tx.caregiver_patient.create({
        data: {
          caregiver_id: caregiver.id,
          patient_id: patient.id,
          kinship: dto.kinship,
        },
      });

      return {
        message: 'Paciente registrado y vinculado exitosamente',
        patient: {
          id: patient.id,
          firstName: patient.first_name,
          paternalLastName: patient.paternal_last_name,
          maternalLastName: patient.maternal_last_name,
          birthDate: patient.birth_date,
          gender: patient.gender,
          bloodType: patient.blood_type,
          medicalNotes: patient.medical_notes,
          kinship: link.kinship,
        },
      };
    });
  }

    async getCaregiverPatients(vitalId: string) {
    // 1. Buscar el perfil de la persona logueada
    const appProfile = await this.prisma.app_profiles.findFirst({
        where: { vital_id: vitalId, deleted_at: null },
        include: { caregivers: true },
    });

    if (!appProfile || !appProfile.caregivers) {
        throw new NotFoundException('Perfil de cuidador no encontrado para este usuario.');
    }

    const caregiverId = appProfile.caregivers.id;

    // 2. Traer la lista completa de pacientes asociados (sin límite de cantidad)
    const caregiverPatients = await this.prisma.caregiver_patient.findMany({
        where: {
        caregiver_id: caregiverId,
        },
        include: {
        patients: {
            include: {
            devices: {
                select: {
                id: true,
                unique_code: true,
                is_online: true,
                last_sync_at: true,
                },
            },
            },
        },
        },
    });

    // 3. Mapeo seguro con destructuring
    return caregiverPatients.map((item: any) => {
        const p = item.patients;
        const device = p?.devices || null;

        return {
        relationId: item.id,
        kinship: item.kinship,
        patient: {
            id: p.id,
            firstName: p.first_name,
            paternalLastName: p.paternal_last_name,
            maternalLastName: p.maternal_last_name,
            fullName: `${p.first_name} ${p.paternal_last_name}${p.maternal_last_name ? ' ' + p.maternal_last_name : ''}`,
            birthDate: p.birth_date,
            gender: p.gender,
            bloodType: p.blood_type,
            medicalNotes: p.medical_notes,
        },
        device: device
            ? {
                id: device.id,
                uniqueCode: device.unique_code,
                isOnline: device.is_online,
                lastSyncAt: device.last_sync_at,
            }
            : null,
        };
    });
    }

    async getPatientSummary(patientId: number) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // 1. Contar medicamentos activos del paciente
    const activeMedicationsCount = await this.prisma.treatment_details.count({
        where: {
        status: 'En_curso',
        deleted_at: null,
        treatments: {
            patient_id: patientId,
            status: 'Activo',
            deleted_at: null,
        },
        },
    });

    // 2. Dosis programadas para hoy
    const dosesTodayCount = await this.prisma.medication_logs.count({
        where: {
        scheduled_datetime: { gte: todayStart, lte: todayEnd },
        deleted_at: null,
        schedules: {
            treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null },
            },
        },
        },
    });

    // 3. Cálculo de % de Adherencia
    const confirmedCount = await this.prisma.medication_logs.count({
        where: {
        status: 'Confirmado',
        deleted_at: null,
        schedules: {
            treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null },
            },
        },
        },
    });

    const totalLogsCount = await this.prisma.medication_logs.count({
        where: {
        deleted_at: null,
        schedules: {
            treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null },
            },
        },
        },
    });

    const adherencePercentage = totalLogsCount > 0
        ? Math.round((confirmedCount / totalLogsCount) * 100)
        : 100;

    // 4. Eventos SOS activos
    const activeSosAlerts = await this.prisma.sos_events.count({
        where: { patient_id: patientId, status: 'Activo' },
    });

    return {
        patientId,
        adherencePercentage,
        activeMedicationsCount,
        dosesTodayCount,
        activeSosAlerts,
    };
    }
}
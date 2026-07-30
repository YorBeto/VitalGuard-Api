import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestMedicationDto } from './dto/request-medication.dto';

@Injectable()
export class MedicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(searchQuery?: string) {
    return this.prisma.medications.findMany({
      where: {
        deleted_at: null,
        ...(searchQuery && {
          OR: [
            { name: { contains: searchQuery, mode: 'insensitive' } },
            { presentation: { contains: searchQuery, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        name: true,
        presentation: true,
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  async requestMedication(vitalId: string, dto: RequestMedicationDto) {
    // 1. Obtener perfil de quien solicita
    const requesterProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });

    // 2. Buscar si el paciente tiene médico asignado
    const doctorRelation = await this.prisma.doctor_patient.findFirst({
      where: { patient_id: dto.patientId, deleted_at: null },
      include: { doctors: true },
    });

    let targetAppProfileId: number | null = null;
    let targetRole = 'ADMIN_SUPPORT';

    if (doctorRelation?.doctors) {
      targetAppProfileId = doctorRelation.doctors.app_profile_id;
      targetRole = 'DOCTOR';
    }

    // 3. Crear notificación persistente si se encontró destinatario
    if (targetAppProfileId) {
      await this.prisma.notifications.create({
        data: {
          app_profile_id: targetAppProfileId,
          patient_id: dto.patientId,
          title: 'Solicitud de Medicamento',
          message: `Se ha solicitado agregar "${dto.medicationName}" (${dto.presentation || 'Sin presentación'}) al catálogo.`,
          type: 'MEDICAMENTO_SOLICITUD',
          metadata: {
            medicationName: dto.medicationName,
            presentation: dto.presentation || null,
            requestedByProfileId: requesterProfile?.id,
          },
        },
      });
    }

    return {
      message:
        targetRole === 'DOCTOR'
          ? 'Solicitud enviada a la bandeja de notificaciones de tu médico tratante.'
          : 'Solicitud enviada al equipo de soporte de VitalGuard.',
      targetRole,
      medicationRequested: {
        name: dto.medicationName,
        presentation: dto.presentation || null,
      },
    };
  }
}
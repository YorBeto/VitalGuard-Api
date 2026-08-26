import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestMedicationDto } from './dto/request-medication.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService
  ) { }

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

    // 2. Buscar TODOS los perfiles que sean Administradores
    const adminProfiles = await this.prisma.app_profiles.findMany({
      where: {
        roles: { name: { contains: 'Admin', mode: 'insensitive' } },
        deleted_at: null
      }
    });

    // 3. Disparar la notificación a todos los administradores usando el NotificationsService
    for (const admin of adminProfiles) {
      await this.notificationsService.createAndPush(admin.id, {
        title: 'Nueva Solicitud de Medicamento',
        message: `Se ha solicitado agregar "${dto.medicationName}" al catálogo.`,
        type: 'MEDICAMENTO_SOLICITUD',
        patientId: dto.patientId || null,
        metadata: {
          medicationName: dto.medicationName,
          presentation: dto.presentation || null,
          requestedByProfileId: requesterProfile?.id,
        },
      });
    }

    return { message: 'Solicitud enviada exitosamente al equipo de administración.' };
  }

  async getPendingRequests(vitalId: string) {
    // 1. Buscamos los IDs de perfil del admin actual
    const profiles = await this.prisma.app_profiles.findMany({
      where: { vital_id: vitalId, deleted_at: null },
      select: { id: true }
    });
    const profileIds = profiles.map(p => p.id);

    return await this.prisma.notifications.findMany({
      where: {
        app_profile_id: { in: profileIds },
        type: 'MEDICAMENTO_SOLICITUD',
        deleted_at: null, 
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // Aprobar solicitud: Crea el medicamento y avisa al doctor/usuario que lo pidió
  async approveMedicationRequest(notificationId: number) {
    // 1. Buscamos la notificación para extraer los datos del metadata
    const notification = await this.prisma.notifications.findUnique({
      where: { id: notificationId },
    });

    if (!notification || !notification.metadata) {
      throw new BadRequestException('Solicitud no encontrada o sin metadatos válidos.');
    }

    const metadata = notification.metadata as any;
    const medName = metadata.medicationName || metadata.medication_name;
    const presentation = metadata.presentation || null;
    const requesterProfileId = metadata.requestedByProfileId;

    if (!medName) {
      throw new BadRequestException('El nombre del medicamento en la solicitud no es válido.');
    }

    // 2. Ejecutamos una transacción de Prisma para asegurar la integridad de la base de datos
    const newMedication = await this.prisma.$transaction(async (tx) => {
      // A. Crear el medicamento oficialmente en el catálogo general
      const createdMed = await tx.medications.create({
        data: {
          name: medName,
          presentation: presentation,
        },
      });

      // B. Marcar la notificación del admin como leída / resuelta
      await tx.notifications.updateMany({
        where: {
          type: 'MEDICAMENTO_SOLICITUD',
          message: notification.message
        },
        data: { is_read: true, deleted_at: new Date() },
      });

      return createdMed;
    });

    // 3. Avisar al doctor/usuario usando el NotificationsService (fuera de la transacción de BD)
    if (requesterProfileId) {
      this.notificationsService.createAndPush(Number(requesterProfileId), {
        title: '¡Medicamento Aprobado!',
        message: `El medicamento "${medName}" ya fue agregado al catálogo oficial y puedes recetarlo.`,
        type: 'SISTEMA',
      }).catch(err => console.error("Error enviando notificación de aprobación al solicitante:", err));
    }

    return {
      success: true,
      message: 'Medicamento aprobado y agregado al catálogo con éxito.',
      medication: newMedication,
    };
  }
}
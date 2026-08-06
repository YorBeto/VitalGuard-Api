import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LinkDeviceDto } from './dto/link-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private formatDeviceCode(code: string): string {
    if (!code) return '';
    
    const cleanCode = code.replace(/[- ]/g, '').toUpperCase();

    if (cleanCode.length === 6) {
      return `${cleanCode.slice(0, 3)}-${cleanCode.slice(3)}`;
    }

    return cleanCode;
  }

  async findByPatient(patientId: number) {
    return this.prisma.devices.findFirst({
      where: { patient_id: patientId, deleted_at: null },
      include: {
        device_compartments: {
          where: { deleted_at: null },
        },
      },
    });
  }

  async upsertFromEsp32(dto: RegisterDeviceDto) {
    const formattedCode = this.formatDeviceCode(dto.deviceId);

    return this.prisma.devices.upsert({
      where: {
        unique_code: formattedCode,
      },
      update: {
        is_online: true,
        last_sync_at: new Date(),
        firmware_version: dto.firmwareVersion ?? '1.0.0',
        deleted_at: null,
      },
      create: {
        unique_code: formattedCode,
        is_online: true,
        last_sync_at: new Date(),
        firmware_version: dto.firmwareVersion ?? '1.0.0',
      },
    });
  }

  async updateStatus(deviceId: string, isOnline: boolean) {
    const formattedCode = this.formatDeviceCode(deviceId);

    return this.prisma.devices.update({
      where: { unique_code: formattedCode },
      data: {
        is_online: isOnline,
        last_sync_at: new Date(),
      },
    });
  }

  async linkToPatient(dto: LinkDeviceDto) {
    // También formateamos por si el usuario en la app lo escribe sin guion
    const formattedCode = this.formatDeviceCode(dto.deviceId);

    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formattedCode, deleted_at: null },
    });

    if (!device) {
      throw new NotFoundException(
        `El dispositivo con código ${formattedCode} no existe en el sistema o no se ha auto-registrado.`,
      );
    }

    return this.prisma.devices.update({
      where: { id: device.id },
      data: {
        patient_id: dto.patientId,
        responsible_caregiver_id: dto.responsibleCaregiverId ?? null,
      },
    });
  }
}
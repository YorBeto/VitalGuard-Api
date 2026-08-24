import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../../prisma/prisma.service';
import { SosEventsService } from '../sos-events/sos-events.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LinkDeviceDto } from './dto/link-device.dto';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('MQTT_CLIENT') private readonly mqttClient: ClientProxy,
    private readonly sosEventsService: SosEventsService,
  ) {}

  public formatDeviceCode(code: string): string {
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
      include: { device_compartments: { where: { deleted_at: null } } },
    });
  }

  async upsertFromEsp32(dto: RegisterDeviceDto) {
    const formattedCode = this.formatDeviceCode(dto.deviceId);
    return this.prisma.devices.upsert({
      where: { unique_code: formattedCode },
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
      data: { is_online: isOnline, last_sync_at: new Date() },
    });
  }

  async linkToPatient(dto: LinkDeviceDto) {
    const formattedCode = this.formatDeviceCode(dto.deviceId);
    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formattedCode, deleted_at: null },
    });
    if (!device) {
      throw new NotFoundException(
        `El dispositivo con código ${formattedCode} no existe o no se ha auto-registrado.`,
      );
    }

    const updated = await this.prisma.devices.update({
      where: { id: device.id },
      data: {
        patient_id: dto.patientId,
        responsible_caregiver_id: dto.responsibleCaregiverId ?? null,
      },
    });

    // Enviar config al dispositivo después de vincular
    await this.sendConfigToDevice(formattedCode, dto.patientId);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════
  // MQTT: Enviar mensajes al ESP32
  // ═══════════════════════════════════════════════════════════

  async sendConfigToDevice(deviceId: string, patientId: number) {
    const treatments = await this.prisma.treatments.findMany({
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

    const allMeds: Array<{
      dosisId: number;
      nombre: string;
      dosis: string | null;
      compartimento: number | null;
      horarios: string[];
    }> = [];

    for (const tr of treatments) {
      for (const td of tr.treatment_details) {
        for (const s of td.schedules) {
          const time = s.time_of_day as unknown as Date;
          const formatted = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
          allMeds.push({
            dosisId: td.id,
            nombre: td.medications?.name ?? 'Medicamento',
            dosis: td.dose_info ?? null,
            compartimento: td.compartment_number ?? null,
            horarios: [formatted],
          });
        }
      }
    }

    const uniqueMeds = allMeds.filter(
      (med, index, self) =>
        self.findIndex((m) => m.dosisId === med.dosisId) === index,
    );

    const allHorarios = uniqueMeds.flatMap((m) => m.horarios).sort();
    const proximaToma = allHorarios.length > 0 ? allHorarios[0] : '--:--';

    const config = {
      proximaToma,
      sosCountdownSeg: 10,
      medicamentos: uniqueMeds,
    };

    this.mqttClient.emit(`vitalguard/${deviceId}/config`, config);
    this.logger.log(`📤 Config enviada a ${deviceId}: ${JSON.stringify(config)}`);
  }

  async sendCommand(deviceId: string, accion: string, payload?: Record<string, any>) {
    const command = { accion, ...payload };
    this.mqttClient.emit(`vitalguard/${deviceId}/comando`, command);
    this.logger.log(`📤 Comando enviado a ${deviceId}: ${accion}`);
  }

  // ═══════════════════════════════════════════════════════════
  // MQTT: Procesar eventos del ESP32
  // ═══════════════════════════════════════════════════════════

  async handleTomaConfirmada(deviceId: string) {
    const formattedCode = this.formatDeviceCode(deviceId);
    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formattedCode, deleted_at: null },
    });
    if (!device?.patient_id) {
      this.logger.warn(`⚠️ Dispositivo ${formattedCode} no tiene paciente asignado`);
      return;
    }

    this.logger.log(`🔍 [TOMA_CONFIRMADA] Iniciando para dispositivo ${formattedCode}, patientId: ${device.patient_id}`);

    // 1. Obtener todos los treatments del paciente
    const treatments = await this.prisma.treatments.findMany({
      where: { patient_id: device.patient_id, deleted_at: null },
      select: {
        id: true,
        treatment_details: {
          select: {
            id: true,
            schedules: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });
    this.logger.log(`📋 [TOMA_CONFIRMADA] Tratamientos encontrados: ${treatments.length}`);

    // 2. Recolectar todos los schedule IDs de TODOS los treatments
    const allScheduleIds: number[] = [];
    for (const tr of treatments) {
      if (tr.treatment_details) {
        for (const td of tr.treatment_details) {
          if (td.schedules) {
            for (const s of td.schedules) {
              allScheduleIds.push(s.id);
            }
          }
        }
      }
    }
    this.logger.log(`📅 [TOMA_CONFIRMADA] Schedule IDs recolectados: ${allScheduleIds.length}`, allScheduleIds);

    // 3. Buscar el log Pendiente MÁS RECIENTE asociado a alguno de estos schedules
    const pendingLog = await this.prisma.medication_logs.findFirst({
      where: {
        schedule_id: { in: allScheduleIds },
        status: 'Pendiente',
        deleted_at: null,
      },
      orderBy: { scheduled_datetime: 'desc' },
    });

    if (!pendingLog) {
      // Debug adicional: buscar si hay algún log asociado a estos schedules
      const anyLog = await this.prisma.medication_logs.findFirst({
        where: {
          schedule_id: { in: allScheduleIds },
          deleted_at: null,
        },
        orderBy: { scheduled_datetime: 'desc' },
      });
      this.logger.warn(`⚠️ No hay logs Pendientes para paciente ${device.patient_id}`);
      this.logger.log(`📝 [TOMA_CONFIRMADA] Último log encontrado:`, anyLog ? {
        id: anyLog.id,
        status: anyLog.status,
        schedule_id: anyLog.schedule_id,
        takenAt: anyLog.actual_taken_datetime,
      } : 'No hay ningún log asociado a estos schedules');
      return;
    }

    this.logger.log(`🎯 [TOMA_CONFIRMADA] Log encontrado: #${pendingLog.id}, status actual: ${pendingLog.status}`);

    await this.prisma.medication_logs.update({
      where: { id: pendingLog.id },
      data: { status: 'Confirmado', actual_taken_datetime: new Date() },
    });

    this.logger.log(`✅ TOMA_CONFIRMADA: Log #${pendingLog.id} marcado como Confirmado. Tomada a las ${pendingLog.actual_taken_datetime}`);

    if (device.responsible_caregiver_id) {
      const caregiver = await this.prisma.caregivers.findFirst({
        where: { id: device.responsible_caregiver_id, deleted_at: null },
      });
      if (caregiver) {
        await this.prisma.notifications.create({
          data: {
            app_profile_id: caregiver.app_profile_id,
            patient_id: device.patient_id,
            title: 'Toma confirmada',
            message: 'El paciente confirmó la toma de su medicamento desde el dispositivo',
            type: 'DOSIS_RECORDATORIO',
          },
        });
      }
    }
  }

  async handleSosAlert(deviceId: string) {
    const formattedCode = this.formatDeviceCode(deviceId);
    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formattedCode, deleted_at: null },
    });

    if (!device?.patient_id) {
      this.logger.warn(`⚠️ SOS: Dispositivo ${formattedCode} no tiene paciente asignado`);
      return;
    }

    this.logger.log(`🚨 SOS RECIBIDO de dispositivo ${formattedCode} para paciente #${device.patient_id}`);
    return this.sosEventsService.create(device.patient_id);
  }
}
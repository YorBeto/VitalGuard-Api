import { Inject, Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../../prisma/prisma.service';
import { SosEventsService } from '../sos-events/sos-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LinkDeviceDto } from './dto/link-device.dto';
import { APP_TIMEZONE, nowInMonterrey, timeDateToMinutes, minutesToTimeString } from '../../common/timezone';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('MQTT_CLIENT') private readonly mqttClient: ClientProxy,
    private readonly sosEventsService: SosEventsService,
    private readonly notificationsService: NotificationsService,
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

    // Auto-set responsable si no se manda: usa el primer cuidador vinculado al paciente (creador)
    let responsibleId = dto.responsibleCaregiverId ?? null;
    if (responsibleId == null) {
      if (device.responsible_caregiver_id) {
        responsibleId = device.responsible_caregiver_id;
      } else {
        const link = await this.prisma.caregiver_patient.findFirst({
          where: { patient_id: dto.patientId, deleted_at: null },
          orderBy: { created_at: 'asc' },
        });
        if (link) responsibleId = link.caregiver_id;
      }
    }

    const updated = await this.prisma.devices.update({
      where: { id: device.id },
      data: {
        patient_id: dto.patientId,
        responsible_caregiver_id: responsibleId,
      },
    });

    // Enviar config al dispositivo después de vincular
    await this.sendConfigToDevice(formattedCode, dto.patientId);

    return updated;
  }

  async updateResponsible(deviceId: number, newCaregiverId: number, vitalId: string) {
    const device = await this.prisma.devices.findFirst({
      where: { id: deviceId, deleted_at: null },
    });
    if (!device?.patient_id) throw new NotFoundException('Dispositivo no encontrado o sin paciente');

    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) throw new NotFoundException('Perfil no encontrado');
    const callerCaregiver = await this.prisma.caregivers.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!callerCaregiver) throw new ForbiddenException('No tienes perfil de cuidador');

    // Permiso: solo el responsable actual puede cambiar (si hay responsable). Si NULL, cualquier vinculado puede reclamar.
    if (device.responsible_caregiver_id != null && device.responsible_caregiver_id !== callerCaregiver.id) {
      throw new ForbiddenException('Solo el responsable actual puede transferir el pastillero');
    }

    // Valida que el nuevo responsable esté vinculado al paciente
    const link = await this.prisma.caregiver_patient.findFirst({
      where: { caregiver_id: newCaregiverId, patient_id: device.patient_id, deleted_at: null },
    });
    if (!link) throw new NotFoundException('El cuidador no está vinculado al paciente');

    return this.prisma.devices.update({
      where: { id: deviceId },
      data: { responsible_caregiver_id: newCaregiverId },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // MQTT: Enviar mensajes al ESP32
  // ═══════════════════════════════════════════════════════════

  /**
   * Genera los siguientes horarios pendientes para un detalle de tratamiento (máx. 4).
   * Usa minutos Monterrey (timeDateToMinutes) para ser independiente del TZ del contenedor.
   */
  private getHorariosForTreatmentDetail(now: Date, td: any): string[] {
    const schedules = td.schedules ?? [];
    if (schedules.length === 0) return [];

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const freqHours = td.frequency_hours ?? 0;

    // Caso 1: Tratamiento recurrente con frecuencia (ej: cada 8 horas)
    if (freqHours > 0) {
      const firstSchedule = schedules[0].time_of_day as unknown as Date;
      const baseMinutes = timeDateToMinutes(firstSchedule);
      const freqMinutes = freqHours * 60;

      let nextMinutes = baseMinutes;
      if (nowMinutes > baseMinutes + 2) {
        const slotsPassed = Math.floor((nowMinutes - baseMinutes) / freqMinutes) + 1;
        nextMinutes = baseMinutes + slotsPassed * freqMinutes;
      }

      const generatedSlots: string[] = [];
      for (let i = 0; i < 4; i++) {
        const slot = (nextMinutes + i * freqMinutes) % (24 * 60);
        generatedSlots.push(minutesToTimeString(slot));
      }
      return generatedSlots;
    }

    // Caso 2: Horarios específicos fijos definidos en schedules
    const formattedSchedules = schedules.map((s: any) => {
      const t = s.time_of_day as unknown as Date;
      const min = timeDateToMinutes(t);
      return {
        minutes: min,
        formatted: minutesToTimeString(min),
      };
    });

    formattedSchedules.sort((a, b) => a.minutes - b.minutes);

    let remaining = formattedSchedules.filter((s) => s.minutes >= nowMinutes - 2);
    if (remaining.length === 0) {
      remaining = formattedSchedules;
    }

    return remaining.slice(0, 4).map((s) => s.formatted);
  }

  async sendConfigToDevice(deviceId: string, patientId: number) {
    const now = nowInMonterrey();
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

    const medicamentos: Array<{
      dosisId: number;
      nombre: string;
      dosis: string | null;
      compartimento: number | null;
      horarios: string[];
    }> = [];

    const allCalculatedTimes: string[] = [];

    for (const tr of treatments) {
      for (const td of tr.treatment_details) {
        // Usa la nueva función para proyectar horarios
        const horarios = this.getHorariosForTreatmentDetail(now, td);
        if (horarios.length > 0) {
          allCalculatedTimes.push(...horarios);
        }

        medicamentos.push({
          dosisId: td.id,
          nombre: td.medications?.name ?? 'Medicamento',
          dosis: td.dose_info ?? null,
          compartimento: td.compartment_number ?? null,
          horarios,
        });
      }
    }

    // Calcular proximaToma global
    let proximaToma = '--:--';
    if (allCalculatedTimes.length > 0) {
      const uniqueSorted = [...new Set(allCalculatedTimes)].sort();
      proximaToma = uniqueSorted[0];
    }

    const config = {
      proximaToma,
      sosCountdownSeg: 10,
      timezone: APP_TIMEZONE,
      medicamentos,
    };

    this.mqttClient.emit(`vitalguard/${deviceId}/config`, config);
    this.logger.log(`📤 Config enviada a ${deviceId} TZ=${APP_TIMEZONE}: ${JSON.stringify(config)}`);
  }

  async sendCommand(deviceId: string, accion: string, payload?: Record<string, any>) {
    const command = { accion, ...payload };
    this.mqttClient.emit(`vitalguard/${deviceId}/comando`, command);
    this.logger.log(`📤 Comando enviado a ${deviceId}: ${accion}`);
  }

  // ═══════════════════════════════════════════════════════════
  // MQTT: Solicitud de resincronización de config (CONTRATO_SOLICITAR_CONFIG)
  // ═══════════════════════════════════════════════════════════

  async handleSolicitarConfig(rawDeviceId: string) {
    const formatted = this.formatDeviceCode(rawDeviceId);

    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formatted, deleted_at: null },
    });

    if (!device) {
      this.logger.warn(`⚠️ [solicitar_config] dispositivo ${formatted} no encontrado, respondiendo con config vacía`);
      const emptyConfig = { proximaToma: '--:--', sosCountdownSeg: 10, medicamentos: [] as any[] };
      this.mqttClient.emit(`vitalguard/${formatted}/config`, emptyConfig);
      // Fallback: responde también al ID crudo si difiere del formateado (ej. A1B2C3 vs A1B-2C3)
      if (formatted !== rawDeviceId) this.mqttClient.emit(`vitalguard/${rawDeviceId}/config`, emptyConfig);
      this.logger.log(`📤 Config vacía enviada a ${formatted} (dispositivo no existe)`);
      return;
    }

    if (!device.patient_id) {
      const emptyConfig = { proximaToma: '--:--', sosCountdownSeg: 10, medicamentos: [] as any[] };
      this.mqttClient.emit(`vitalguard/${formatted}/config`, emptyConfig);
      if (formatted !== rawDeviceId) this.mqttClient.emit(`vitalguard/${rawDeviceId}/config`, emptyConfig);
      this.logger.log(`📤 Config vacía enviada a ${formatted} (sin paciente vinculado) por solicitar_config`);
      return;
    }

    await this.sendConfigToDevice(formatted, device.patient_id);
    // Asegura entrega aunque el firmware esté suscrito al ID crudo
    if (formatted !== rawDeviceId) {
      await this.sendConfigToDevice(rawDeviceId, device.patient_id);
    }
    this.logger.log(`📤 Config resincronizada a ${formatted} por solicitar_config (paciente ${device.patient_id})`);
  }

  // ═══════════════════════════════════════════════════════════
  // MQTT: Procesar eventos del ESP32
  // ═══════════════════════════════════════════════════════════

  async handleTomaConfirmada(
    deviceId: string,
    status: keyof typeof import('@prisma/client').log_status = 'Confirmado',
    dosisId?: number,
    horario?: string,
  ) {
    const formattedCode = this.formatDeviceCode(deviceId);
    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formattedCode, deleted_at: null },
    });
    if (!device?.patient_id) {
      this.logger.warn(`⚠️ Dispositivo ${formattedCode} no tiene paciente asignado`);
      return;
    }

    this.logger.log(`🔍 [TOMA_CONFIRMADA] Iniciando para dispositivo ${formattedCode}, patientId: ${device.patient_id}, dosisId: ${dosisId}, horario: ${horario}`);

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
                scheduled_datetime: true,
              },
            },
          },
        },
      },
    });
    this.logger.log(`📋 [TOMA_CONFIRMADA] Tratamientos encontrados: ${treatments.length}`);

    // 2. Recolectar schedule IDs
    const allScheduleIds: number[] = [];
    let specificScheduleIds: number[] = [];

    for (const tr of treatments) {
      if (tr.treatment_details) {
        for (const td of tr.treatment_details) {
          if (td.schedules) {
            for (const s of td.schedules) {
              allScheduleIds.push(s.id);
              if (dosisId && td.id === dosisId) {
                // Verificar horario si se proporciona
                if (horario) {
                  const sTime = new Date(s.scheduled_datetime).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                  if (sTime === horario) {
                    specificScheduleIds.push(s.id);
                  }
                } else {
                  specificScheduleIds.push(s.id);
                }
              }
            }
          }
        }
      }
    }

    let pendingLog: any;

    if (dosisId && specificScheduleIds.length > 0) {
      this.logger.log(`🎯 [TOMA_CONFIRMADA] Buscando por dosisId ${dosisId} y horario ${horario || 'cualquiera'}`);
      pendingLog = await this.prisma.medication_logs.findFirst({
        where: {
          schedule_id: { in: specificScheduleIds },
          status: 'Pendiente',
          deleted_at: null,
        },
        orderBy: { scheduled_datetime: 'desc' },
      });
    } else {
      this.logger.log(`📅 [TOMA_CONFIRMADA] Buscando por fallback (scheduleIds: ${allScheduleIds.length})`);
      pendingLog = await this.prisma.medication_logs.findFirst({
        where: {
          schedule_id: { in: allScheduleIds },
          status: 'Pendiente',
          deleted_at: null,
        },
        orderBy: { scheduled_datetime: 'desc' },
      });
    }

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
      data: { status, actual_taken_datetime: new Date() },
    });

    this.logger.log(`✅ TOMA_CONFIRMADA: Log #${pendingLog.id} marcado como ${status}. Tomada a las ${pendingLog.actual_taken_datetime}`);

    // Notifica a TODOS los cuidadores vinculados (con push FCM+WS + deduplicación)
    const profileIds = await this.notificationsService.caregiverProfilesForPatient(device.patient_id);
    for (const pid of profileIds) {
      // Anti-spam: si ya notificamos toma confirmada hace <2 min, skip duplicado
      const recent = await this.prisma.notifications.findFirst({
        where: {
          app_profile_id: pid,
          patient_id: device.patient_id,
          type: 'DOSIS_RECORDATORIO',
          title: 'Toma confirmada',
          created_at: { gte: new Date(Date.now() - 2 * 60 * 1000) },
          deleted_at: null,
        },
      });
      if (recent) {
        this.logger.log(`[TOMA_CONFIRMADA] skip push duplicado para profile ${pid} (toma reciente #${recent.id})`);
        continue;
      }
      await this.notificationsService.createAndPush(pid, {
        title: 'Toma confirmada',
        message: 'El paciente confirmó la toma de su medicamento desde el dispositivo',
        type: 'DOSIS_RECORDATORIO',
        patientId: device.patient_id,
        metadata: { device_code: formattedCode, log_id: pendingLog.id } as any,
      });
    }

    // 👉 Empujar config actualizada con proximaToma calculado, para que el dispositivo avance de 11:00 a 12:00 etc.
    await this.sendConfigToDevice(formattedCode, device.patient_id);
  }

  async handleCompartmentEvent(
    deviceId: string,
    compartmentNumber: number,
    tipo: 'COMPARTIMENTO_ABIERTO' | 'COMPARTIMENTO_CERRADO' | string,
  ) {
    const formattedCode = this.formatDeviceCode(deviceId);
    const device = await this.prisma.devices.findFirst({
      where: { unique_code: formattedCode, deleted_at: null },
    });
    if (!device?.patient_id) {
      this.logger.warn(`⚠️ [Compartimento] Dispositivo ${formattedCode} sin paciente`);
      return;
    }
    const isOpen = tipo === 'COMPARTIMENTO_ABIERTO';
    const newStatus = isOpen ? 'open' : 'closed';

    // 1. Actualizar solo status en device_compartments
    const existingComp = await this.prisma.device_compartments.findFirst({
      where: { device_id: device.id, compartment_number: compartmentNumber, deleted_at: null },
    });
    if (existingComp) {
      await this.prisma.device_compartments.update({
        where: { id: existingComp.id },
        data: { status: newStatus as any },
      });
    } else {
      // Intenta crear; si hay soft-deleted previo, lo restaura
      const soft = await this.prisma.device_compartments.findFirst({
        where: { device_id: device.id, compartment_number: compartmentNumber },
      });
      if (soft) {
        await this.prisma.device_compartments.update({
          where: { id: soft.id },
          data: { status: newStatus as any, deleted_at: null },
        });
      } else {
        await this.prisma.device_compartments.create({
          data: { device_id: device.id, compartment_number: compartmentNumber, status: newStatus as any },
        });
      }
    }
    this.logger.log(`📦 [Compartimento] ${formattedCode} comp.${compartmentNumber} -> ${newStatus}`);

    // Solo validar al ABRIR, al cerrar solo actualizamos estado
    if (!isOpen) return;

    const now = nowInMonterrey();
    // Ventana: 0-15m = Confirmado, 15-20m = Retraso, >20 o sin pendiente = alerta incorrecto
    const windowRetrasoMs = 20 * 60 * 1000;
    const earliest = new Date(now.getTime() - windowRetrasoMs);

    // Buscar logs Pendiente en ventana que mapeen al compartimento abierto
    const pendingLogs = await this.prisma.medication_logs.findMany({
      where: {
        status: 'Pendiente',
        deleted_at: null,
        scheduled_datetime: { gte: earliest, lte: now },
        schedules: {
          deleted_at: null,
          treatment_details: {
            deleted_at: null,
            compartment_number: compartmentNumber,
            treatments: { patient_id: device.patient_id, deleted_at: null },
          },
        },
      },
      include: {
        schedules: { include: { treatment_details: { include: { medications: true, treatments: true } } } },
      },
      orderBy: { scheduled_datetime: 'desc' },
    });

    const expectedCompartments = await this.prisma.medication_logs.findMany({
      where: {
        status: 'Pendiente',
        deleted_at: null,
        scheduled_datetime: { gte: earliest, lte: now },
        schedules: {
          deleted_at: null,
          treatment_details: { treatments: { patient_id: device.patient_id, deleted_at: null } },
        },
      },
      include: { schedules: { select: { treatment_details: { select: { compartment_number: true } } } } },
    });
    const expectedSet = [...new Set(expectedCompartments.map((l) => l.schedules?.treatment_details?.compartment_number).filter((n): n is number => n != null))];

    if (pendingLogs.length > 0) {
      // Plan B: firmware es autoritativo — solo telemetría, no duplica log ni audio
      this.logger.log(`✅ [Compartimento] comp.${compartmentNumber} CORRECTO (telemetría) -> pendiente #${pendingLogs[0].id} se esperará TOMA_CONFIRMADA del firmware`);
      return;
    }

    // Compartimento incorrecto o fuera de ventana
    const expectedStr = expectedSet.length ? expectedSet.map((n) => `#${n}`).join(', ') : 'ninguno (sin dosis pendiente)';
    const isWrongCompartment = expectedSet.length > 0 && !expectedSet.includes(compartmentNumber);
    const title = isWrongCompartment ? 'Compartimento incorrecto' : 'Apertura fuera de horario';
    const message = isWrongCompartment
      ? `Paciente abrió comp. ${compartmentNumber}, esperaba ${expectedStr}. Verifica medicación.`
      : `Se abrió comp. ${compartmentNumber} sin dosis pendiente. Esperados: ${expectedStr}.`;

    this.logger.warn(`🚨 [Compartimento] ${title} device=${formattedCode} comp=${compartmentNumber} esperados=${expectedStr} (Plan B: sin audio, firmware ya sonó)`);

    // Notificación a TODOS los cuidadores vinculados con throttling 5 min por compartimento
    const profileIds2 = await this.notificationsService.caregiverProfilesForPatient(device.patient_id);
    for (const pid of profileIds2) {
      // Anti-spam: máximo 1 notificación de compartimento incorrecto/fuera horario cada 5 min por paciente+compartimento
      const recentWrong = await this.prisma.notifications.findFirst({
        where: {
          app_profile_id: pid,
          patient_id: device.patient_id,
          type: 'DOSIS_RECORDATORIO',
          title: { in: ['Compartimento incorrecto', 'Apertura fuera de horario'] },
          created_at: { gte: new Date(Date.now() - 5 * 60 * 1000) },
          metadata: { path: ['compartimento_abierto'], equals: compartmentNumber },
          deleted_at: null,
        },
      });
      if (recentWrong) {
        this.logger.log(`[Compartimento] skip notificación throttled para profile ${pid} comp ${compartmentNumber} (reciente #${recentWrong.id})`);
        continue;
      }
      // También limita global por paciente: máx 3 notificaciones de compartimento cada 10 min
      const recentCount = await this.prisma.notifications.count({
        where: {
          app_profile_id: pid,
          patient_id: device.patient_id,
          type: 'DOSIS_RECORDATORIO',
          title: { in: ['Compartimento incorrecto', 'Apertura fuera de horario'] },
          created_at: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          deleted_at: null,
        },
      });
      if (recentCount >= 3) {
        this.logger.warn(`[Compartimento] skip notificación por flood control para profile ${pid} (${recentCount} en 10m)`);
        continue;
      }
      await this.notificationsService.createAndPush(pid, {
        title,
        message,
        type: 'DOSIS_RECORDATORIO',
        patientId: device.patient_id,
        metadata: {
          device_code: formattedCode,
          compartimento_abierto: compartmentNumber,
          compartimentos_esperados: expectedSet,
          fuera_ventana: pendingLogs.length === 0 && expectedSet.length === 0,
        } as any,
      });
    }
    if (profileIds2.length) this.logger.log(`📩 Notificación compartimento enviada (con throttling) a cuidadores`);

    await this.sendConfigToDevice(formattedCode, device.patient_id);
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
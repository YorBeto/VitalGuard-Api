import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiService, VoiceAnalysis } from './gemini.service';
import { PatientsService } from '../patients/patients.service';
import { TreatmentsService } from '../treatments/treatments.service';
import { SchedulesService } from '../schedules/schedules.service';
import { DevicesService } from '../devices/devices.service';
import { SosEventsService } from '../sos-events/sos-events.service';

export type VoiceAction =
  | 'SOS_TRIGGERED'
  | 'MARKED_TAKEN'
  | 'NEXT_SCHEDULE'
  | 'NONE';

export interface VoiceCommandResult extends VoiceAnalysis {
  action: VoiceAction;
}

/**
 * Orquestador de IA (Fase A).
 *
 * Toma el comando de voz transcrito por Alexa, arma el contexto REAL del
 * paciente desde Prisma, pide a Gemini que clasifique la intención y ejecuta
 * la acción correspondiente (SOS real, confirmar toma, próxima toma, o
 * respuesta empática si UNKNOWN).
 */
@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly patientsService: PatientsService,
    private readonly treatmentsService: TreatmentsService,
    private readonly schedulesService: SchedulesService,
    private readonly devicesService: DevicesService,
    private readonly sosEventsService: SosEventsService,
  ) {}

  /**
   * Procesa un comando de voz para el paciente indicado.
   * @param patientId  paciente sobre el que se interpreta el comando
   * @param text       texto transcrito por Alexa
   * @param vitalId    vital_id del usuario autenticado (valida pertenencia)
   */
  async processVoiceCommand(input: {
    patientId: number;
    text: string;
    vitalId: string;
  }): Promise<VoiceCommandResult> {
    const { patientId, text, vitalId } = input;

    // 0. Validar que el paciente pertenece al caregiver autenticado
    const patient = await this.patientsService.findOne(patientId, vitalId);

    // 1. Cargar contexto real del paciente
    const context = await this.buildContext(patientId, vitalId);

    // 2. Clasificar intención con Gemini
    const analysis = await this.gemini.analyzeVoiceCommand(text, context);

    // 3. Mapear intención → acción real
    switch (analysis.intent) {
      case 'SOS':
        return this.executeSos(analysis, patientId, vitalId);
      case 'MARK_TAKEN':
        return this.executeMarkTaken(analysis, patientId);
      case 'CHECK_SCHEDULE':
        return this.executeNextSchedule(analysis, patientId, vitalId);
      case 'UNKNOWN':
      default:
        return {
          ...analysis,
          action: 'NONE',
        };
    }
  }

  /** Arma el contexto real del paciente para la clasificación de Gemini. */
  private async buildContext(patientId: number, vitalId: string) {
    const patient = await this.prisma.patients.findFirst({
      where: { id: patientId, deleted_at: null },
    });

    const name = patient
      ? [patient.first_name, patient.paternal_last_name]
          .filter(Boolean)
          .join(' ')
      : 'Paciente';

    let activeTreatment: any = null;
    try {
      activeTreatment = await this.treatmentsService.findActive(vitalId, patientId);
    } catch (err: any) {
      // Sin tratamiento activo no es un error del orquestador; se informa en el contexto.
      if (!(err instanceof NotFoundException)) throw err;
    }

    const schedules = await this.schedulesService.findToday(vitalId, patientId);
    const device = await this.devicesService.findByPatient(vitalId, patientId);

    const upcoming = this.getUpcomingTakes(schedules);

    return {
      nombre_paciente: name,
      paciente_id: patientId,
      tratamiento_activo: activeTreatment
        ? {
            status: activeTreatment.status,
            medicamentos: (activeTreatment.treatment_details || []).map((d: any) => ({
              nombre: d.medications?.name,
              presentacion: d.medications?.presentation,
              dosis: d.dose_info,
              frecuencia_horas: d.frequency_hours,
              compartimento: d.compartment_number,
            })),
          }
        : null,
      proximas_tomas: upcoming,
      dispositivo: device
        ? {
            unique_code: device.unique_code,
            is_online: device.is_online,
            compartimentos: (device.device_compartments || []).map((c: any) => ({
              numero: c.compartment_number,
              estado: c.status,
            })),
          }
        : null,
    };
  }

  /** Calcula las próximas tomas del día desde los horarios. */
  private getUpcomingTakes(schedules: any[]) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    return schedules
      .map((s) => {
        const t = new Date(s.time_of_day as unknown as Date);
        const minutes = t.getHours() * 60 + t.getMinutes();
        return {
          hora: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
          minutes,
          medicamento: s.treatment_details?.medications?.name,
          dosis: s.treatment_details?.dose_info,
          compartimento: s.treatment_details?.compartment_number,
        };
      })
      .sort((a, b) => a.minutes - b.minutes)
      .map(({ minutes, ...rest }) => rest)
      .map((t) => ({
        ...t,
        pasada: nowMinutes > this.toMinutes(t.hora),
      }));
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  /** SOS → alerta real (sos_events) */
  private async executeSos(
    analysis: VoiceAnalysis,
    patientId: number,
    vitalId: string,
  ): Promise<VoiceCommandResult> {
    await this.sosEventsService.create(vitalId, patientId);
    this.logger.log(`🚨 SOS registrado para paciente ${patientId}`);

    return {
      ...analysis,
      reply:
        analysis.reply ||
        'Entendido, estoy notificando a tu cuidador y a tus contactos de emergencia. Intenta mantener la calma.',
      action: 'SOS_TRIGGERED',
    };
  }

  /** MARK_TAKEN → confirma la toma pendiente más reciente del paciente */
  private async executeMarkTaken(
    analysis: VoiceAnalysis,
    patientId: number,
  ): Promise<VoiceCommandResult> {
    const pending = await this.findPendingLog(patientId);
    if (!pending) {
      return {
        ...analysis,
        action: 'NONE',
        reply:
          'No tengo ninguna toma pendiente por confirmar en este momento. Revisa tu aplicación para más detalles.',
      };
    }

    await this.prisma.medication_logs.update({
      where: { id: pending.id },
      data: {
        status: 'Confirmado',
        actual_taken_datetime: new Date(),
        voice_confirmed: true,
      },
    });

    const medName =
      pending.schedules?.treatment_details?.medications?.name ||
      analysis.medication_mentioned ||
      'tu medicamento';

    this.logger.log(`💊 Toma confirmada por voz (log ${pending.id}) para paciente ${patientId}`);

    return {
      ...analysis,
      reply: analysis.reply || `Listo, he registrado que ya tomaste ${medName}. ¡Muy bien!`,
      action: 'MARKED_TAKEN',
    };
  }

  /** CHECK_SCHEDULE → responde la próxima toma real */
  private async executeNextSchedule(
    analysis: VoiceAnalysis,
    patientId: number,
    vitalId: string,
  ): Promise<VoiceCommandResult> {
    const schedules = await this.schedulesService.findToday(vitalId, patientId);
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

    const upcoming = schedules
      .map((s) => {
        const t = new Date(s.time_of_day as unknown as Date);
        return {
          s,
          minutes: t.getHours() * 60 + t.getMinutes(),
        };
      })
      .filter((x) => x.minutes >= nowMinutes)
      .sort((a, b) => a.minutes - b.minutes)[0];

    const candidate = upcoming ?? schedules[0];
    if (!candidate) {
      return {
        ...analysis,
        action: 'NONE',
        reply:
          'No tienes medicamentos programados en este momento. Consulta tu aplicación para más detalles.',
      };
    }

    const t = new Date(candidate.s.time_of_day as unknown as Date);
    const hora = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const detail = candidate.s.treatment_details;
    const medName = detail?.medications?.name || 'medicamento';
    const dose = detail?.dose_info ? `, dosis ${detail.dose_info}` : '';

    return {
      ...analysis,
      reply:
        analysis.reply ||
        `Tu próxima toma es ${medName}${dose} a las ${hora}. Recuerda tomarla a tiempo.`,
      action: 'NEXT_SCHEDULE',
    };
  }

  /** Encuentra el log Pendiente más próximo del paciente. */
  private async findPendingLog(patientId: number) {
    const treatments = await this.prisma.treatments.findMany({
      where: { patient_id: patientId, deleted_at: null },
      select: { id: true },
    });
    const treatmentIds = treatments.map((t) => t.id);

    const details = await this.prisma.treatment_details.findMany({
      where: { treatment_id: { in: treatmentIds }, deleted_at: null },
      select: { id: true },
    });
    const detailIds = details.map((d) => d.id);

    const schedules = await this.prisma.schedules.findMany({
      where: { treatment_detail_id: { in: detailIds }, deleted_at: null },
      select: { id: true },
    });
    const scheduleIds = schedules.map((s) => s.id);

    return this.prisma.medication_logs.findFirst({
      where: {
        schedule_id: { in: scheduleIds },
        status: 'Pendiente',
        deleted_at: null,
      },
      orderBy: { scheduled_datetime: 'asc' },
      include: {
        schedules: {
          include: {
            treatment_details: { include: { medications: true } },
          },
        },
      },
    });
  }
}

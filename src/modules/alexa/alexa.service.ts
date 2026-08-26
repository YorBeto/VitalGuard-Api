import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlexaIdentityService } from './alexa-identity.service';
import { AlexaResolverService } from './alexa-resolver.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { SosEventsService } from '../sos-events/sos-events.service';

interface AlexaRequestBody {
  version?: string;
  session?: { new?: boolean };
  context?: {
    System?: {
      application?: { applicationId?: string };
      user?: { accessToken?: string };
    };
  };
  request?: {
    type?: string;
    intent?: { name?: string; slots?: Record<string, any> };
    locale?: string;
  };
}

@Injectable()
export class AlexaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identityService: AlexaIdentityService,
    private readonly resolver: AlexaResolverService,
    private readonly orchestrator: AiOrchestratorService,
    private readonly sosEventsService: SosEventsService,
  ) {}

  async handle(body: AlexaRequestBody) {
    const accessToken = body?.context?.System?.user?.accessToken;
    const request = body?.request;
    const appId = body?.context?.System?.application?.applicationId;

    console.log(
      `[Alexa] POST /alexa | skill=${appId} | requestType=${request?.type} | intent=${request?.intent?.name}`,
    );

    if (!accessToken) {
      console.log('[Alexa] Sin accessToken. Pidiendo vinculación.');
      return this.speak(
        'Para usar VitalGuard necesito que conectes tu cuenta. Abre la aplicación móvil y toca "Conectar Alexa".',
      );
    }

    let vitalId: string;
    try {
      vitalId = await this.identityService.resolveVitalId(accessToken);
      console.log(`[Alexa] Identidad resuelta: vitalId=${vitalId}`);
    } catch (err) {
      console.warn('[Alexa] Error resolviendo identidad:', (err as any)?.message || err);
      return this.speak(
        'Tu sesión expiró. Vuelve a conectar tu cuenta en la aplicación móvil.',
      );
    }

    const resolution = await this.resolver.resolve(vitalId);
    console.log(
      `[Alexa] Resolución paciente: ok=${resolution.ok} | patientId=${resolution.patient?.id} | message=${resolution.message}`,
    );
    if (!resolution.ok || !resolution.patient) {
      return this.speak(
        resolution.message ??
          'No fue posible identificar tu paciente. Completa la configuración en la aplicación móvil.',
      );
    }

    const patient = resolution.patient;

    switch (request?.type) {
      case 'LaunchRequest':
        return this.handleLaunch();
      case 'IntentRequest':
        return this.handleIntent(
          request.intent?.name,
          request.intent?.slots,
          patient.id,
          vitalId,
        );
      case 'SessionEndedRequest':
        return this.speak('Hasta pronto. Cuidate mucho.');
      default:
        return this.handleLaunch();
    }
  }

  private async handleIntent(
    intentName?: string,
    slots?: Record<string, any>,
    patientId?: number,
    vitalId?: string,
  ) {
    switch (intentName) {
      case 'ConsultarTomasIntent':
        return this.handleCheckSchedule(patientId!);
      case 'TomarMedicinaIntent':
      case 'ConfirmarTomaIntent':
        return this.handleMarkTaken(patientId!);
      case 'ListarTomasHoyIntent':
        return this.handleListToday(patientId!);
      case 'SosIntent':
        return this.handleSos(patientId!);
      case 'AMAZON.HelpIntent':
        return this.speak(
          'Puedes preguntarme cuándo debes tomar tu medicina, confirmar que ya la tomaste, o pedir ayuda de emergencia. ¿Qué necesitas?',
        );
      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return this.speak('Hasta pronto. Cuidate mucho.');
      default:
        const freeText = this.extractFreeText(slots);
        return this.handleFreeForm(intentName, patientId!, vitalId!, freeText);
    }
  }

  private handleLaunch() {
    return this.speak(
      'Hola, soy VitalGuard. Pregúntame cuándo debes tomar tu medicina o pide ayuda de emergencia.',
    );
  }

  private extractFreeText(slots?: Record<string, any>): string {
    const slotName = process.env.ALEXA_TEXT_SLOT_NAME || 'texto';
    const slot = slots?.[slotName];
    const value: any =
      slot?.value ??
      slot?.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name;
    return typeof value === 'string' ? value.trim() : '';
  }

  private async handleFreeForm(
    intentName: string | undefined,
    patientId: number,
    vitalId: string,
    text: string,
  ) {
    const configuredIntent = process.env.ALEXA_INTENT_NAME;
    const isConfigured = Boolean(configuredIntent && intentName === configuredIntent);
    const isSystemFallback =
      intentName === 'AMAZON.FallbackIntent' || intentName === undefined;

    if (!isConfigured && !isSystemFallback) {
      return this.speak(
        'No estoy seguro de eso. Puedes preguntarme cuándo tomar tu medicina o pedir ayuda de emergencia.',
      );
    }

    const textToUse = text || '';
    if (!textToUse) {
      return this.speak(
        'No estoy seguro de eso. Puedes preguntarme cuándo tomar tu medicina o pedir ayuda de emergencia.',
      );
    }

    try {
      const result = await this.orchestrator.processVoiceCommand({
        patientId,
        text: textToUse,
        vitalId,
      });
      return this.speak(result.reply);
    } catch (error: any) {
      console.error('❌ Error en AI orquestador desde Alexa:', error?.message || error);
      return this.speak(
        'No estoy seguro de eso. Puedes preguntarme cuándo tomar tu medicina o pedir ayuda de emergencia.',
      );
    }
  }

  /** Listar todas las tomas del día para tratamientos activos */
  private async handleListToday(patientId: number) {
    try {
      const schedules = await this.prisma.schedules.findMany({
        where: {
          treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null, status: 'Activo' },
            deleted_at: null,
            status: 'En_curso',
          },
          deleted_at: null,
        },
        include: {
          treatment_details: {
            include: { medications: true },
          },
        },
      });

      if (schedules.length === 0) {
        return this.speak(
          'No tienes tomas programadas para hoy en tus tratamientos activos. Consulta tu aplicación para más detalles.',
        );
      }

      const sorted = schedules
        .map((s) => {
          const t = new Date(s.time_of_day);
          const minutes = t.getHours() * 60 + t.getMinutes();
          const hh = String(t.getHours()).padStart(2, '0');
          const mm = String(t.getMinutes()).padStart(2, '0');
          return { s, minutes, hhmm: `${hh}:${mm}` };
        })
        .sort((a, b) => a.minutes - b.minutes);

      const nowTz = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
      const start = new Date(nowTz);
      start.setHours(0, 0, 0, 0);
      const end = new Date(nowTz);
      end.setHours(23, 59, 59, 999);

      const scheduleIds = schedules.map((s) => s.id);
      const logs = await this.prisma.medication_logs.findMany({
        where: {
          schedule_id: { in: scheduleIds },
          deleted_at: null,
          scheduled_datetime: { gte: start, lte: end },
        },
        select: { schedule_id: true, status: true },
      });

      const logBySchedule = new Map<number, string>();
      for (const l of logs) {
        logBySchedule.set(l.schedule_id, l.status as string);
      }

      const parts: string[] = [];
      for (const { s, hhmm } of sorted) {
        const med = s.treatment_details.medications?.name || 'medicamento';
        const comp = s.treatment_details.compartment_number;
        const compTxt = comp != null ? ` en compartimento ${comp}` : '';
        const statusRaw = logBySchedule.get(s.id);
        let statusTxt = '';
        if (statusRaw) {
          if (statusRaw === 'Confirmado') statusTxt = ', ya tomada';
          else if (statusRaw === 'Pendiente') statusTxt = ', pendiente';
          else if (statusRaw === 'Retraso') statusTxt = ', tomada con retraso';
          else if (statusRaw === 'Omitida') statusTxt = ', omitida';
          else statusTxt = `, ${statusRaw.toLowerCase()}`;
        }
        parts.push(`${med} a las ${hhmm}${compTxt}${statusTxt}`);
      }

      let speech: string;
      if (parts.length <= 5) {
        speech = `Hoy tienes ${parts.length} ${parts.length === 1 ? 'toma' : 'tomas'}: ${parts.join('; ')}.`;
      } else {
        const first = parts.slice(0, 4).join('; ');
        const rest = parts.length - 4;
        speech = `Hoy tienes ${parts.length} tomas. Las próximas 4 son: ${first}; y ${rest} más. Revisa la app para el listado completo.`;
      }

      return this.speak(speech);
    } catch (e: any) {
      console.error('[Alexa] handleListToday error', e?.message || e);
      return this.speak(
        'Tuve un problema al consultar tus tomas de hoy. Intenta de nuevo en un momento.',
      );
    }
  }

  /** Consultar próxima toma programada */
  private async handleCheckSchedule(patientId: number) {
    const schedules = await this.prisma.schedules.findMany({
      where: {
        treatment_details: {
          treatments: { patient_id: patientId, deleted_at: null, status: 'Activo' },
          deleted_at: null,
          status: 'En_curso',
        },
        deleted_at: null,
      },
      include: {
        treatment_details: {
          include: { medications: true },
        },
      },
    });

    if (schedules.length === 0) {
      return this.speak(
        'No tienes medicamentos programados en tratamientos activos. Consulta tu aplicación para más detalles.',
      );
    }

    const nowTz = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const nowMinutes = nowTz.getHours() * 60 + nowTz.getMinutes();

    let next = schedules
      .map((s) => {
        const t = new Date(s.time_of_day);
        const minutes = t.getHours() * 60 + t.getMinutes();
        return { s, minutes };
      })
      .filter((x) => x.minutes >= nowMinutes)
      .sort((a, b) => a.minutes - b.minutes)[0];

    let isTomorrow = false;
    if (!next) {
      next = schedules
        .map((s) => {
          const t = new Date(s.time_of_day);
          return { s, minutes: t.getHours() * 60 + t.getMinutes() };
        })
        .sort((a, b) => a.minutes - b.minutes)[0];
      isTomorrow = true;
    }

    const detail = next.s.treatment_details;
    const med = detail.medications?.name || 'medicamento';
    const dose = detail.dose_info ? `, dosis ${detail.dose_info}` : '';
    const hours = String(Math.floor(next.minutes / 60)).padStart(2, '0');
    const mins = String(next.minutes % 60).padStart(2, '0');
    const dayText = isTomorrow ? 'mañana' : 'hoy';

    return this.speak(
      `Tu próxima toma es ${med}${dose} ${dayText} a las ${hours}:${mins}. Recuerda tomarla a tiempo.`,
    );
  }

  /** Confirmar tomas con validación horaria inteligente (uno o varios medicamentos a la vez) */
  private async handleMarkTaken(patientId: number) {
    const now = new Date();
    const nowTz = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));

    // Ventana permitida: desde 45 minutos antes hasta 120 minutos después
    const windowStart = new Date(nowTz.getTime() - 120 * 60 * 1000);
    const windowEnd = new Date(nowTz.getTime() + 45 * 60 * 1000);

    // 1. Buscar todas las tomas pendientes que caen dentro de la ventana horaria actual
    const validPendingLogs = await this.prisma.medication_logs.findMany({
      where: {
        deleted_at: null,
        status: 'Pendiente',
        scheduled_datetime: { gte: windowStart, lte: windowEnd },
        schedules: {
          treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null, status: 'Activo' },
          },
        },
      },
      include: {
        schedules: {
          include: {
            treatment_details: { include: { medications: true } },
          },
        },
      },
    });

    // 2. Si no hay dosis en esta ventana, buscar si hay una más tarde hoy para avisar la hora
    if (validPendingLogs.length === 0) {
      const todayEnd = new Date(nowTz);
      todayEnd.setHours(23, 59, 59, 999);

      const futurePending = await this.prisma.medication_logs.findFirst({
        where: {
          deleted_at: null,
          status: 'Pendiente',
          scheduled_datetime: { gt: windowEnd, lte: todayEnd },
          schedules: {
            treatment_details: {
              treatments: { patient_id: patientId, deleted_at: null, status: 'Activo' },
            },
          },
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

      if (futurePending) {
        const schedTime = new Date(futurePending.scheduled_datetime);
        const hh = String(schedTime.getHours()).padStart(2, '0');
        const mm = String(schedTime.getMinutes()).padStart(2, '0');
        const medName = futurePending.schedules.treatment_details.medications?.name || 'tu medicamento';
        
        return this.speak(
          `Aún no es hora de tu dosis. Tu próxima toma de ${medName} está programada para las ${hh}:${mm}.`,
        );
      }

      return this.speak(
        'No tienes ninguna dosis pendiente por tomar en este momento. Revisa la aplicación para consultar tu plan.',
      );
    }

    // 3. Confirmar todas las tomas de la ventana válida (ej. 10:00 y 10:20 juntas)
    const logIds = validPendingLogs.map((l) => l.id);
    await this.prisma.medication_logs.updateMany({
      where: { id: { in: logIds } },
      data: {
        status: 'Confirmado',
        actual_taken_datetime: new Date(),
        voice_confirmed: true,
      },
    });

    const medNames = Array.from(
      new Set(
        validPendingLogs.map(
          (l) => l.schedules?.treatment_details?.medications?.name || 'tu medicamento',
        ),
      ),
    );

    const formattedNames =
      medNames.length === 1
        ? medNames[0]
        : medNames.slice(0, -1).join(', ') + ' y ' + medNames[medNames.length - 1];

    return this.speak(`Listo, he registrado la toma de ${formattedNames}. ¡Muy bien!`);
  }

  /** Disparar evento SOS */
  private async handleSos(patientId: number) {
    await this.sosEventsService.create(patientId);

    return this.speak(
      'Entendido. Estoy notificando a tu cuidador y a los contactos de emergencia. Si puedes, busca un lugar seguro.',
    );
  }

  private speak(text: string) {
    return {
      version: '1.0',
      response: {
        outputSpeech: { type: 'PlainText', text },
        shouldEndSession: false,
      },
    };
  }
}
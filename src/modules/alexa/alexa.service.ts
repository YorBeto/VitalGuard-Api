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

/**
 * Backend de la skill de Alexa (POST /alexa).
 *
 * Identifica al usuario por su accessToken (vía Vital ID), resuelve su
 * paciente (B5/B6/B7) y responde en formato ASK. Nunca lanza errores HTTP 500:
 * Alexa exige una respuesta 200 con un mensaje empático en cualquier caso.
 *
 * Caso B9: los intents de texto libre (configurable vía ALEXA_INTENT_NAME),
 * el AMAZON.FallbackIntent y cualquier intent desconocido delegan en el
 * AiOrchestratorService (Gemini) para responder con contexto real.
 */
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

    // B3/B4: sin token → pedir vinculación
    if (!accessToken) {
      console.log('[Alexa] B3/B4 -> Sin accessToken. Pidiendo vinculación.');
      return this.speak(
        'Para usar VitalGuard necesito que conectes tu cuenta. Abre la aplicación móvil y toca "Conectar Alexa".',
      );
    }

    console.log(
      `[Alexa] accessToken presente (${accessToken.length} chars): ${accessToken.slice(0, 12)}...`,
    );

    // Validar token contra Vital ID
    let vitalId: string;
    try {
      vitalId = await this.identityService.resolveVitalId(accessToken);
      console.log(`[Alexa] Identidad resuelta: vitalId=${vitalId}`);
    } catch (err) {
      console.warn('[Alexa] B8 -> Error resolviendo identidad:', (err as any)?.message || err);
      // B8: token inválido/revocado
      return this.speak(
        'Tu sesión expiró. Vuelve a conectar tu cuenta en la aplicación móvil.',
      );
    }

    // Resolver paciente
    const resolution = await this.resolver.resolve(vitalId);
    console.log(
      `[Alexa] Resolución paciente: ok=${resolution.ok} | patientId=${resolution.patient?.id} | message=${resolution.message}`,
    );
    if (!resolution.ok || !resolution.patient) {
      // B5 o B7
      return this.speak(
        resolution.message ??
          'No fue posible identificar tu paciente. Completa la configuración en la aplicación móvil.',
      );
    }

    const patient = resolution.patient;

    // Enrutado por tipo de request / intent
    switch (request?.type) {
      case 'LaunchRequest':
        console.log('[Alexa] LaunchRequest -> bienvenida');
        return this.handleLaunch();
      case 'IntentRequest':
        console.log(`[Alexa] IntentRequest -> intent="${request.intent?.name}"`);
        return this.handleIntent(
          request.intent?.name,
          request.intent?.slots,
          patient.id,
          vitalId,
        );
      case 'SessionEndedRequest':
        console.log('[Alexa] SessionEndedRequest -> despedida');
        return this.speak('Hasta pronto. Cuidate mucho.');
      default:
        console.log(`[Alexa] requestType desconocido="${request?.type}" -> bienvenida`);
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
        console.log('[Alexa] ConsultarTomasIntent -> consulta de próxima toma');
        return this.handleCheckSchedule(patientId!);
      case 'TomarMedicinaIntent':
      case 'ConfirmarTomaIntent':
        console.log(`[Alexa] ${intentName} -> marcar toma como tomada`);
        return this.handleMarkTaken(patientId!);
      case 'ListarTomasHoyIntent':
        console.log('[Alexa] ListarTomasHoyIntent -> lista tomas del día');
        return this.handleListToday(patientId!);
      case 'SosIntent':
        console.log('[Alexa] SosIntent -> disparar SOS');
        return this.handleSos(patientId!);
      case 'AMAZON.HelpIntent':
        return this.speak(
          'Puedes preguntarme cuándo debes tomar tu medicina, confirmar que ya la tomaste, o pedir ayuda de emergencia. ¿Qué necesitas?',
        );
      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return this.speak('Hasta pronto. Cuidate mucho.');
      default:
        // B9: FallbackIntent, intent libre configurable o intent desconocido → IA real
        const freeText = this.extractFreeText(slots);
        console.log(`[Alexa] Intent desconocido/no-manejado "${intentName}" -> IA libre. Texto="${freeText}"`);
        return this.handleFreeForm(intentName, patientId!, vitalId!, freeText);
    }
  }

  private handleLaunch() {
    return this.speak(
      'Hola, soy VitalGuard. Pregúntame cuándo debes tomar tu medicina o pide ayuda de emergencia.',
    );
  }

  /**
   * Extrae el texto libre de un intent desde el slot configurable
   * (ALEXA_TEXT_SLOT_NAME, default "texto"). Devuelve string (vacío si no hay).
   */
  private extractFreeText(slots?: Record<string, any>): string {
    const slotName = process.env.ALEXA_TEXT_SLOT_NAME || 'texto';
    const slot = slots?.[slotName];
    const value: any =
      slot?.value ??
      slot?.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name;
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * B9: delega en el AiOrchestratorService para responder con IA a frases
   * libres. Siempre fail-safe: si falta texto o el orquestador falla, responde
   * con un mensaje empático (nunca 500).
   */
  private async handleFreeForm(
    intentName: string | undefined,
    patientId: number,
    vitalId: string,
    text: string,
  ) {
    const configuredIntent = process.env.ALEXA_INTENT_NAME;

    // Solo procesa el intent libre configurado o el FallbackIntent/desconocido
    const isConfigured = Boolean(configuredIntent && intentName === configuredIntent);
    const isSystemFallback =
      intentName === 'AMAZON.FallbackIntent' || intentName === undefined;

    if (!isConfigured && !isSystemFallback) {
      // intent propio conocido pero no de texto libre → mensaje genérico
      return this.speak(
        'No estoy seguro de eso. Puedes preguntarme cuándo tomar tu medicina o pedir ayuda de emergencia.',
      );
    }

    const textToUse = text || this.genericPromptForIntent(intentName);
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
      // Fail-safe: nunca romper la skill por un fallo de IA
      console.error('❌ Error en AI orquestador desde Alexa:', error?.message || error);
      return this.speak(
        'No estoy seguro de eso. Puedes preguntarme cuándo tomar tu medicina o pedir ayuda de emergencia.',
      );
    }
  }

  /** Prompt por defecto si el intent libre no trajo texto (p. ej. FallbackIntent sin slot). */
  private genericPromptForIntent(intentName: string | undefined): string {
    void intentName;
    return '';
  }

  /** ListarTomasHoyIntent — lista todas las tomas del día (read-only, no toca MQTT) */
  private async handleListToday(patientId: number) {
    try {
      // Reuse same source as SchedulesService.findToday — read-only
      const schedules = await this.prisma.schedules.findMany({
        where: {
          treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null },
            deleted_at: null,
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
          'No tienes tomas programadas para hoy. Consulta tu aplicación para más detalles.',
        );
      }

      // Ordenar por hora del día
      const sorted = schedules
        .map((s) => {
          const t = new Date(s.time_of_day);
          const minutes = t.getHours() * 60 + t.getMinutes();
          const hh = String(t.getHours()).padStart(2, '0');
          const mm = String(t.getMinutes()).padStart(2, '0');
          return { s, minutes, hhmm: `${hh}:${mm}` };
        })
        .sort((a, b) => a.minutes - b.minutes);

      // Buscar logs de hoy para enriquecer con estado (Pendiente/Confirmado/Retraso/Omitida)
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
        // si hay varios logs mismo schedule hoy (no debería), conserva el último status
        logBySchedule.set(l.schedule_id, l.status as string);
      }

      // Construir frases por toma: "Metformina a las 08:00 en compartimento 1, pendiente"
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

      // Limitar verbosidad: si >5, resumir
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

  /** ConsultarTomasIntent — próxima toma real del paciente */
  private async handleCheckSchedule(patientId: number) {
    const schedules = await this.prisma.schedules.findMany({
      where: {
        treatment_details: {
          treatments: { patient_id: patientId, deleted_at: null },
          deleted_at: null,
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
        'No tienes medicamentos programados en este momento. Consulta tu aplicación para más detalles.',
      );
    }

    // Próxima toma: menor hora del día no pasada
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    let next = schedules
      .map((s) => {
        const t = new Date(s.time_of_day);
        const minutes = t.getHours() * 60 + t.getMinutes();
        return { s, minutes };
      })
      .filter((x) => x.minutes >= nowMinutes)
      .sort((a, b) => a.minutes - b.minutes)[0];

    // Si no queda toma hoy, tomar la primera de mañana
    if (!next) {
      next = schedules
        .map((s) => {
          const t = new Date(s.time_of_day);
          return { s, minutes: t.getHours() * 60 + t.getMinutes() };
        })
        .sort((a, b) => a.minutes - b.minutes)[0];
    }

    const detail = next.s.treatment_details;
    const med = detail.medications?.name || 'medicamento';
    const dose = detail.dose_info ? `, dosis ${detail.dose_info}` : '';
    const hours = String(Math.floor(next.minutes / 60)).padStart(2, '0');
    const mins = String(next.minutes % 60).padStart(2, '0');

    return this.speak(
      `Tu próxima toma es ${med}${dose} a las ${hours}:${mins}. Recuerda tomarla a tiempo.`,
    );
  }

  /** TomarMedicinaIntent — confirma la toma pendiente más reciente (voice_confirmed) */
  private async handleMarkTaken(patientId: number) {
    // Buscar el log pendiente más próximo del paciente
    const pending = await this.prisma.medication_logs.findFirst({
      where: {
        deleted_at: null,
        status: 'Pendiente',
        schedules: {
          treatment_details: {
            treatments: { patient_id: patientId, deleted_at: null },
          },
        },
      },
      orderBy: { scheduled_datetime: 'asc' },
      include: { schedules: { include: { treatment_details: { include: { medications: true } } } } },
    });

    if (!pending) {
      return this.speak(
        'No tengo ninguna toma pendiente por confirmar en este momento.',
      );
    }

    await this.prisma.medication_logs.update({
      where: { id: pending.id },
      data: {
        status: 'Confirmado',
        actual_taken_datetime: new Date(),
        voice_confirmed: true,
      },
    });

    const med = pending.schedules.treatment_details.medications?.name || 'tu medicamento';
    return this.speak(`Listo, he registrado que ya tomaste ${med}. ¡Muy bien!`);
  }

  /** SosIntent — dispara un evento SOS real con notificaciones FCM+WS */
  private async handleSos(patientId: number) {
    await this.sosEventsService.create(patientId);

    return this.speak(
      'Entendido. Estoy notificando a tu cuidador y a los contactos de emergencia. Si puedes, busca un lugar seguro.',
    );
  }

  /** Construye una respuesta ASK válida (siempre 200) */
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

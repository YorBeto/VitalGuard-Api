import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlexaIdentityService } from './alexa-identity.service';
import { AlexaResolverService } from './alexa-resolver.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';

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
  ) {}

  async handle(body: AlexaRequestBody) {
    const accessToken = body?.context?.System?.user?.accessToken;
    const request = body?.request;

    // B3/B4: sin token → pedir vinculación
    if (!accessToken) {
      return this.speak(
        'Para usar VitalGuard necesito que conectes tu cuenta. Abre la aplicación móvil y toca "Conectar Alexa".',
      );
    }

    // Validar token contra Vital ID
    let vitalId: string;
    try {
      vitalId = await this.identityService.resolveVitalId(accessToken);
    } catch {
      // B8: token inválido/revocado
      return this.speak(
        'Tu sesión expiró. Vuelve a conectar tu cuenta en la aplicación móvil.',
      );
    }

    // Resolver paciente
    const resolution = await this.resolver.resolve(vitalId);
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
        return this.handleMarkTaken(patientId!);
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
        // B9: FallbackIntent, intent libre configurable o intent desconocido → IA real
        const freeText = this.extractFreeText(slots);
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

  /** SosIntent — dispara un evento SOS real */
  private async handleSos(patientId: number) {
    await this.prisma.sos_events.create({
      data: { patient_id: patientId, status: 'Activo' },
    });

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

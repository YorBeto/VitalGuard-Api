import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

export interface VoiceAnalysis {
  intent: 'MARK_TAKEN' | 'CHECK_SCHEDULE' | 'SOS' | 'UNKNOWN';
  medication_mentioned: string | null;
  reply: string;
}

@Injectable()
export class GeminiService {
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ GEMINI_API_KEY no está configurada en el .env');
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey || '' });
    this.model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  }

  async analyzeVoiceCommand(
    spokenText: string,
    patientContext: any,
  ): Promise<VoiceAnalysis> {
    const prompt = `
      Eres el motor de inteligencia artificial de VitalGuard, un sistema IoT de monitoreo médico.
      Tu tarea es analizar el siguiente comando de voz dicho por un paciente o cuidador: "${spokenText}"

      Contexto real del paciente actual:
      ${JSON.stringify(patientContext)}

      Clasifica la intención EXACTA del usuario en una de las siguientes categorías:
      - "MARK_TAKEN": El usuario confirma que ya tomó un medicamento.
      - "CHECK_SCHEDULE": El usuario pregunta cuándo le toca su medicina o qué debe tomar.
      - "SOS": El usuario indica que se siente mal, tuvo un accidente, o necesita ayuda médica urgente.
      - "UNKNOWN": El comando no tiene relación con salud, medicamentos o emergencias.

      En "reply" escribe una respuesta breve, natural, empática y conversacional que el asistente de voz leerá en voz alta al usuario. "medication_mentioned" debe ser el nombre del medicamento que el usuario mencionó (o null si no aplica).
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              intent: {
                type: 'STRING',
                enum: ['MARK_TAKEN', 'CHECK_SCHEDULE', 'SOS', 'UNKNOWN'],
              },
              medication_mentioned: { type: 'STRING' },
              reply: { type: 'STRING' },
            },
            required: ['intent', 'reply'],
          },
        },
      });

      // Logging de uso (tokens/costo) para monitoreo por vital_id
      const usage = (response as any).usageMetadata as
        | { totalTokenCount?: number; promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
      if (usage) {
        console.log(
          `🧠 [Gemini] tokens: total=${usage.totalTokenCount ?? '?'} (in=${usage.promptTokenCount ?? '?'} out=${usage.candidatesTokenCount ?? '?'}) modelo=${this.model}`,
        );
      }

      const responseText = response.text || '';
      // Robustez: por si el modelo añade bloques de código pese al responseSchema
      const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson) as VoiceAnalysis;
    } catch (error: any) {
      console.error('❌ Detalle exacto del error en Gemini:', error?.message || error);
      throw new InternalServerErrorException(
        `Fallo en el servicio de IA: ${error?.message || 'Error desconocido'}`,
      );
    }
  }
}

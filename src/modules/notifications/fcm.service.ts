import { Injectable, Logger } from '@nestjs/common';
import { cert, type ServiceAccount } from 'firebase-admin';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Tipo de notificación para elegir prioridad/canal (sos > alta). */
  channelId?: string;
  priority?: 'high' | 'normal';
}

/**
 * Servicio de push notifications vía Firebase Cloud Messaging (FCM).
 *
 * La app móvil (Flutter) ya reporta su token a `POST /notifications/token`.
 * Aquí se envían los push a esos tokens. Es fail-safe: si no hay credenciales
 * de service account configuradas, no se inicializa Firebase y `send()` se
 * convierte en no-op (no rompe el flujo).
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private initialized = false;

  constructor() {
    this.initialize();
  }

  private hasApp(): boolean {
    try {
      getApp();
      return true;
    } catch {
      return false;
    }
  }

  private initialize() {
    const fromPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (this.hasApp()) {
      this.initialized = true;
      return;
    }

    this.logger.log(`[FCM] cwd=${process.cwd()} path=${fromPath ?? '-'} hasEnv=${!!fromEnv}`);

    try {
      let serviceAccount: ServiceAccount | null = null;
      if (fromPath) {
        const candidates = [
          fromPath,
          resolve(process.cwd(), fromPath),
          resolve(__dirname, '../../../', fromPath.replace(/^\.\//, '')),
          '/app/secrets/firebase-service-account.json',
          './secrets/firebase-service-account.json',
        ];
        let raw: string | null = null;
        for (const p of candidates) {
          const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
          if (existsSync(abs)) {
            this.logger.log(`[FCM] Leyendo service account de ${abs}`);
            raw = readFileSync(abs, 'utf-8');
            break;
          }
          try {
            raw = readFileSync(p, 'utf-8');
            this.logger.log(`[FCM] Leyendo service account de ${p} (fallback)`);
            break;
          } catch {}
        }
        if (!raw) throw new Error(`No se encontró archivo en ${fromPath} (probado ${candidates.join(', ')})`);
        serviceAccount = JSON.parse(raw) as ServiceAccount;
      } else if (fromEnv) {
        // Soporta JSON plano o base64
        let jsonStr = fromEnv.trim();
        if (!jsonStr.startsWith('{')) {
          try { jsonStr = Buffer.from(jsonStr, 'base64').toString('utf-8'); } catch {}
        }
        serviceAccount = JSON.parse(jsonStr) as ServiceAccount;
      } else {
        this.logger.warn(
          'Sin credenciales (FIREBASE_SERVICE_ACCOUNT_PATH / FIREBASE_SERVICE_ACCOUNT). Push deshabilitado. device_tokens quedará vacío.',
        );
        return;
      }

      initializeApp({ credential: cert(serviceAccount!) });
      this.initialized = true;
      this.logger.log(`Firebase inicializado correctamente. project=${(serviceAccount as any).project_id ?? 'unknown'}`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error inicializando Firebase: ${message}`);
      this.initialized = false;
    }
  }

  /**
   * Devuelve qué códigos de FCM indican token inválido/borrado y deben limpiarse en BD.
   * Si en el futuro inyectamos Prisma aquí, borramos directo; por ahora solo logueamos para no crear ciclo.
   */
  private isInvalidTokenError(code?: string): boolean {
    return (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    );
  }

  private resolveChannel(message: PushMessage): string {
    if (message.channelId) return message.channelId;
    const type = message.data?.type;
    if (type === 'SOS_ALERTA') return 'vitalguard_sos';
    if (type === 'INVITACION_CUIDADOR') return 'vitalguard_invitations';
    if (type === 'DOSIS_RECORDATORIO') return 'vitalguard_medication';
    return 'vitalguard_high_importance';
  }

  async send(message: PushMessage): Promise<void> {
    if (!this.initialized) {
      this.logger.warn(`[FCM] No inicializado. No se envía push title="${message.title}" type=${message.data?.type ?? '-'}`);
      return;
    }
    if (message.tokens.length === 0) {
      this.logger.warn(`[FCM] Sin tokens. No se envía push title="${message.title}" type=${message.data?.type ?? '-'}. device_tokens vacío para este perfil.`);
      return;
    }
    this.logger.log(`[FCM] Enviando push title="${message.title}" type=${message.data?.type ?? '-'} tokens=${message.tokens.length} channel=${this.resolveChannel(message)}`);
    const type = message.data?.type;
    const isSos = type === 'SOS_ALERTA';
    const channelId = this.resolveChannel(message);
    try {
      const response = await getMessaging().sendEachForMulticast({
        tokens: message.tokens,
        notification: { title: message.title, body: message.body },
        data: message.data ?? {},
        android: {
          priority: (message.priority ?? (isSos ? 'high' : 'high')) as 'high',
          notification: {
            channelId,
            priority: 'high',
            visibility: 'public',
            ...(isSos ? { sound: 'default', sticky: false } : {}),
          },
        },
        apns: {
          headers: { 'apns-priority': isSos ? '10' : '5' },
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              ...(isSos
                ? { 'interruption-level': 'critical' as any }
                : {}),
            },
          },
        },
      });
      this.logger.log(`[FCM] Resultado success=${response.successCount} failure=${response.failureCount}/${response.responses.length} title="${message.title}"`);
      if (response.failureCount > 0) {
        const invalidTokens: string[] = [];
        response.responses.forEach((r, i) => {
          if (!r.success && this.isInvalidTokenError((r.error as any)?.code)) {
            invalidTokens.push(message.tokens[i]);
          }
          if (!r.success) {
            this.logger.warn(
              `[FCM] Push fallido [${message.tokens[i].slice(0, 12)}...]: ${(r.error as any)?.code ?? r.error?.message}`,
            );
          }
        });
        this.logger.warn(
          `[FCM] ${response.failureCount}/${response.responses.length} push fallidos. Tokens inválidos: ${invalidTokens.length}`,
        );
        if (invalidTokens.length > 0) {
          this.logger.warn(
            `[FCM] Tokens para limpiar en device_tokens: ${invalidTokens.join(', ').slice(0, 300)}`,
          );
        }
      }
    } catch (err: any) {
      const message2 = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FCM] Error enviando push title="${message.title}": ${message2}`);
    }
  }
}

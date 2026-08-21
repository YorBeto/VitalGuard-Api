import { Injectable } from '@nestjs/common';
import { cert, type ServiceAccount } from 'firebase-admin';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';

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

    try {
      let serviceAccount: ServiceAccount;
      if (fromPath) {
        const raw = readFileSync(fromPath, 'utf-8');
        serviceAccount = JSON.parse(raw) as ServiceAccount;
      } else if (fromEnv) {
        serviceAccount = JSON.parse(fromEnv) as ServiceAccount;
      } else {
        console.warn(
          '[FCM] Sin credenciales (FIREBASE_SERVICE_ACCOUNT_PATH / FIREBASE_SERVICE_ACCOUNT). Push deshabilitado.',
        );
        return;
      }

      initializeApp({ credential: cert(serviceAccount) });
      this.initialized = true;
      console.log('[FCM] Firebase inicializado correctamente.');
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[FCM] Error inicializando Firebase:', message);
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
    if (!this.initialized || message.tokens.length === 0) {
      return;
    }
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
      if (response.failureCount > 0) {
        const invalidTokens: string[] = [];
        response.responses.forEach((r, i) => {
          if (!r.success && this.isInvalidTokenError((r.error as any)?.code)) {
            invalidTokens.push(message.tokens[i]);
          }
          if (!r.success) {
            console.warn(
              `[FCM] Push fallido [${message.tokens[i].slice(0, 12)}...]: ${(r.error as any)?.code ?? r.error?.message}`,
            );
          }
        });
        console.warn(
          `[FCM] ${response.failureCount}/${response.responses.length} push fallidos. Tokens inválidos: ${invalidTokens.length}`,
        );
        if (invalidTokens.length > 0) {
          console.warn(
            `[FCM] Tokens para limpiar en device_tokens: ${invalidTokens.join(', ').slice(0, 200)}`,
          );
        }
      } else {
        console.log(`[FCM] Push enviado a ${response.successCount} dispositivo(s)`);
      }
    } catch (err: any) {
      const message2 = err instanceof Error ? err.message : String(err);
      console.error('[FCM] Error enviando push:', message2);
    }
  }
}

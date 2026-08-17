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

  async send(message: PushMessage): Promise<void> {
    if (!this.initialized || message.tokens.length === 0) {
      return;
    }
    try {
      const response = await getMessaging().sendEachForMulticast({
        tokens: message.tokens,
        notification: { title: message.title, body: message.body },
        data: message.data ?? {},
      });
      if (response.failureCount > 0) {
        console.warn(
          `[FCM] ${response.failureCount}/${response.responses.length} push fallidos.`,
        );
      }
    } catch (err: any) {
      const message2 = err instanceof Error ? err.message : String(err);
      console.error('[FCM] Error enviando push:', message2);
    }
  }
}

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly resend: Resend;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey === 're_...') {
      throw new Error(
        'RESEND_API_KEY no está configurada en el .env (variable RESEND_API_KEY)',
      );
    }
    this.resend = new Resend(apiKey);
  }

  async send(message: MailMessage) {
    const from =
      process.env.MAIL_FROM || 'VitalGuard <no-reply@vitalguard.app>';
    try {
      const { data, error } = await this.resend.emails.send({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      });
      if (error) {
        console.error('[Mail] Resend error:', error);
        throw new InternalServerErrorException(
          `No se pudo enviar el correo: ${error.message}`,
        );
      }
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Mail] Error inesperado al enviar correo:', message);
      throw new InternalServerErrorException(
        'No se pudo enviar el correo en este momento',
      );
    }
  }
}

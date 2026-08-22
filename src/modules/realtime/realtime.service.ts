import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  /** Room por usuario (todos sus roles comparten mismo vital_id) */
  private room(vitalId: string) {
    return `vital:${vitalId}`;
  }

  private emailRoom(email: string) {
    return `email:${email.trim().toLowerCase()}`;
  }

  emitToVital(vitalId: string, event: string, payload: unknown) {
    if (!this.server) {
      this.logger.warn(`Server no inicializado, no se emite ${event} -> ${vitalId}`);
      return;
    }
    const r = this.room(vitalId);
    const count = this.server.sockets.adapter.rooms.get(r)?.size ?? 0;
    this.logger.log(`[WS emit] ${event} -> ${r} (${count} sockets) `);
    this.server.to(r).emit(event, payload);
  }

  emitToEmail(email: string, event: string, payload: unknown) {
    if (!this.server) return;
    const r = this.emailRoom(email);
    const count = this.server.sockets.adapter.rooms.get(r)?.size ?? 0;
    this.logger.log(`[WS emit] ${event} -> ${r} (${count} sockets) `);
    this.server.to(r).emit(event, payload);
  }

  /** Broadcast a lista de vitalIds */
  emitToMany(vitalIds: string[], event: string, payload: unknown) {
    for (const vid of vitalIds) this.emitToVital(vid, event, payload);
  }

  /** Atajo para notificación genérica */
  emitNotification(vitalId: string, notification: unknown) {
    this.emitToVital(vitalId, 'notification:new', notification);
  }

  async emitUnreadCount(vitalId: string, count: number) {
    this.emitToVital(vitalId, 'notification:unread-count', { count });
  }
}

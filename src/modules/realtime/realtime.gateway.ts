import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email?: string;
  exp?: number;
}

@WebSocketGateway({
  namespace: 'realtime',
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly realtimeService: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.realtimeService.setServer(server);
    this.logger.log('WS Gateway /realtime inicializado');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(`[WS] Conexión rechazada ${client.id}: sin token`);
        client.disconnect();
        return;
      }
      const payload = await this.verifyToken(token);
      const vitalId = payload.sub;

      // vital_id existe? (soft check)
      const profile = await this.prisma.app_profiles.findFirst({
        where: { vital_id: vitalId, deleted_at: null },
        select: { id: true },
      });
      if (!profile) {
        this.logger.warn(`[WS] vitalId ${vitalId} sin app_profile, igual se permite conexión para onboarding`);
      }

      // Guardar en socket.data
      (client.data as any).vitalId = vitalId;
      (client.data as any).email = payload.email;

      const room = `vital:${vitalId}`;
      await client.join(room);
      this.logger.log(`[WS] ${client.id} conectado vitalId=${vitalId} -> ${room}`);

      // Sala por email para invitaciones por correo (push inmediato sin vital_id)
      if (payload.email) {
        const emailRoom = `email:${payload.email.trim().toLowerCase()}`;
        await client.join(emailRoom);
        this.logger.log(`[WS] ${client.id} también unido a ${emailRoom}`);
      }

      // Enviar estado inicial: unread count + últimas 20 notificaciones
      const allIds = await this.prisma.app_profiles.findMany({
        where: { vital_id: vitalId, deleted_at: null },
        select: { id: true },
      });
      const ids = allIds.map((p) => p.id);
      if (ids.length > 0) {
        const [count, recent] = await Promise.all([
          this.prisma.notifications.count({
            where: { app_profile_id: { in: ids }, is_read: false, deleted_at: null },
          }),
          this.prisma.notifications.findMany({
            where: { app_profile_id: { in: ids }, deleted_at: null },
            orderBy: { created_at: 'desc' },
            take: 20,
          }),
        ]);
        client.emit('notification:unread-count', { count });
        client.emit('notification:sync', recent);
      }

      client.emit('connected', { vitalId, room });
    } catch (e: any) {
      this.logger.warn(`[WS] Auth fallida ${client.id}: ${e.message}`);
      client.emit('error', { message: 'Unauthorized: ' + e.message });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const vitalId = (client.data as any)?.vitalId;
    this.logger.log(`[WS] ${client.id} desconectado vitalId=${vitalId ?? '-'}`);
  }

  // Cliente puede pedir re-sync manual
  @SubscribeMessage('notification:sync')
  async handleSync(@ConnectedSocket() client: Socket) {
    const vitalId = (client.data as any)?.vitalId;
    if (!vitalId) return { error: 'No autenticado' };
    const ids = (
      await this.prisma.app_profiles.findMany({
        where: { vital_id: vitalId, deleted_at: null },
        select: { id: true },
      })
    ).map((p) => p.id);
    const data = await this.prisma.notifications.findMany({
      where: { app_profile_id: { in: ids }, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    client.emit('notification:sync', data);
    return data;
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() data: any) {
    return { event: 'pong', data, ts: new Date().toISOString() };
  }

  private extractToken(client: Socket): string | null {
    // 1) auth.token (recomendado socket.io)
    const authToken = (client.handshake.auth as any)?.token;
    if (authToken) return String(authToken).replace(/^Bearer\s+/i, '');

    // 2) query ?token=
    const queryToken = client.handshake.query?.token as string | undefined;
    if (queryToken) return queryToken.replace(/^Bearer\s+/i, '');

    // 3) header Authorization
    const header = client.handshake.headers.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');

    return null;
  }

  private async verifyToken(token: string): Promise<JwtPayload> {
    const secret =
      process.env.JWT_SECRET ||
      'c16f28b5fc222a4700fe9e5caaa3e3c2936cc68cb70f248aada34b75fd8c35d9';
    return this.jwtService.verifyAsync<JwtPayload>(token, { secret });
  }
}

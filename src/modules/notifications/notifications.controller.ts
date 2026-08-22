import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId, GetEmail } from '../../common/decorators/get-user.decorator';
import { RegisterTokenDto } from './dto/register-token.dto';

@ApiTags('Notifications (Notificaciones)')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('token')
  @ApiOperation({
    summary: 'Registrar el token FCM del dispositivo del usuario',
    description:
      'La app móvil llama a este endpoint al arrancar y en cada refresco de token para poder recibir notificaciones push.',
  })
  @ApiBody({ type: RegisterTokenDto })
  @ApiResponse({ status: 201, description: 'Token registrado' })
  async registerToken(
    @GetVitalId() vitalId: string,
    @GetEmail() email: string | undefined,
    @Body() dto: RegisterTokenDto,
  ) {
    // email param se usa para repush de invitaciones por correo (JWT a veces no trae email)
    const bodyEmail = (dto as any)?.email as string | undefined;
    const effectiveEmail = email ?? bodyEmail;
    return this.notificationsService.registerToken(
      vitalId,
      dto.token,
      dto.platform,
      effectiveEmail,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Contar notificaciones no leídas del usuario' })
  @ApiResponse({
    status: 200,
    description: 'Cantidad de notificaciones no leídas',
    schema: { example: { count: 3 } },
  })
  async unreadCount(@GetVitalId() vitalId: string) {
    return this.notificationsService.unreadCount(vitalId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar notificaciones del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de notificaciones' })
  async findAll(@GetVitalId() vitalId: string) {
    return this.notificationsService.findAllByUser(vitalId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas las notificaciones como leídas' })
  @ApiResponse({ status: 200, description: 'Todas marcadas como leídas' })
  async markAllAsRead(@GetVitalId() vitalId: string) {
    return this.notificationsService.markAllAsRead(vitalId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar una notificación como leída' })
  @ApiResponse({ status: 200, description: 'Notificación actualizada' })
  @ApiResponse({ status: 404, description: 'Notificación no encontrada' })
  async markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @GetVitalId() vitalId: string,
  ) {
    return this.notificationsService.markAsRead(id, vitalId);
  }

  @Delete('token')
  @ApiOperation({ summary: 'Eliminar token FCM (logout)' })
  @ApiResponse({ status: 200, description: 'Token eliminado' })
  async removeToken(
    @GetVitalId() vitalId: string,
    @Body() dto: RegisterTokenDto,
  ) {
    return this.notificationsService.removeToken(vitalId, dto.token);
  }
}

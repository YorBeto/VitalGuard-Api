import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId, GetEmail } from '../../common/decorators/get-user.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';

@ApiTags('Invitations (Invitaciones de cuidadores)')
@ApiBearerAuth()
@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('patients/:patientId')
  @ApiOperation({
    summary: 'Invitar a un familiar a cuidar a un paciente',
    description:
      'Permite a un cuidador invitar a otra persona (por vital_id si ya es usuario, o por email si es externa) para que cuide a un paciente.',
  })
  @ApiBody({ type: CreateInvitationDto })
  @ApiResponse({ status: 201, description: 'Invitación creada exitosamente' })
  @ApiResponse({ status: 403, description: 'Sin acceso a este paciente' })
  @ApiResponse({
    status: 409,
    description: 'Invitación duplicada o ya vinculado',
  })
  async create(
    @GetVitalId() vitalId: string,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(vitalId, patientId, dto);
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Listar invitaciones pendientes recibidas por el usuario',
  })
  @ApiResponse({ status: 200, description: 'Lista de invitaciones pendientes' })
  async findPending(
    @GetVitalId() vitalId: string,
    @GetEmail() jwtEmail?: string,
    @Query('email') queryEmail?: string,
  ) {
    const email = jwtEmail ?? queryEmail;
    return this.invitationsService.findPending(vitalId, email);
  }

  @Get('sent')
  @ApiOperation({ summary: 'Listar invitaciones enviadas por el usuario' })
  @ApiResponse({ status: 200, description: 'Lista de invitaciones enviadas' })
  async findSent(@GetVitalId() vitalId: string) {
    return this.invitationsService.findSent(vitalId);
  }

  @Post('accept')
  @ApiOperation({
    summary: 'Aceptar una invitación usando el token del enlace',
    description:
      'Permite a un invitado (nuevo o existente) aceptar su invitación con el token recibido por correo. Requiere sesión iniciada.',
  })
  @ApiBody({ schema: { example: { token: 'abcdef...' } } })
  @ApiResponse({ status: 200, description: 'Invitación aceptada' })
  @ApiResponse({ status: 404, description: 'Invitación no encontrada' })
  @ApiResponse({ status: 403, description: 'Token inválido o sin permiso' })
  @ApiResponse({ status: 410, description: 'Invitación expirada' })
  async acceptByToken(
    @GetVitalId() vitalId: string,
    @Body('token') token: string,
  ) {
    return this.invitationsService.acceptByToken(vitalId, token);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Aceptar una invitación para cuidar a un paciente',
    description:
      'Vincula al cuidador aceptante con el paciente. Para invitaciones por email se requiere el token de la invitación.',
  })
  @ApiQuery({
    name: 'token',
    required: false,
    description: 'Token requerido para aceptar invitaciones enviadas por email',
  })
  @ApiQuery({ name: 'email', required: false, description: 'Email del invitado (fallback si JWT no trae email)' })
  @ApiResponse({ status: 200, description: 'Invitación aceptada' })
  @ApiResponse({ status: 403, description: 'Sin permiso o token inválido' })
  @ApiResponse({ status: 410, description: 'Invitación expirada' })
  async accept(
    @GetVitalId() vitalId: string,
    @GetEmail() jwtEmail: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('token') token?: string,
    @Query('email') queryEmail?: string,
  ) {
    const email = jwtEmail ?? queryEmail;
    return this.invitationsService.accept(vitalId, id, token, email);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Rechazar una invitación' })
  @ApiQuery({
    name: 'token',
    required: false,
    description:
      'Token requerido para rechazar invitaciones enviadas por email',
  })
  @ApiQuery({ name: 'email', required: false, description: 'Email del invitado (fallback)' })
  @ApiResponse({ status: 200, description: 'Invitación rechazada' })
  async reject(
    @GetVitalId() vitalId: string,
    @GetEmail() jwtEmail: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('token') token?: string,
    @Query('email') queryEmail?: string,
  ) {
    const email = jwtEmail ?? queryEmail;
    return this.invitationsService.reject(vitalId, id, token, email);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar una invitación (solo el remitente)' })
  @ApiResponse({ status: 200, description: 'Invitación cancelada' })
  @ApiResponse({ status: 403, description: 'Solo el remitente puede cancelar' })
  async cancel(
    @GetVitalId() vitalId: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.invitationsService.cancel(vitalId, id);
  }
}

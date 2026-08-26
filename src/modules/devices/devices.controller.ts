import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { Ctx, MessagePattern, MqttContext, Payload } from '@nestjs/microservices';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LinkDeviceDto } from './dto/link-device.dto';
import { SendCommandDto } from './dto/device-command.dto';
import { UpdateResponsibleDto } from './dto/update-responsible.dto';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@ApiTags('Devices (Dispositivos)')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // ═══════════════════════════════════════════════════════════
  // HTTP REST (App Móvil)
  // ═══════════════════════════════════════════════════════════

  @UseGuards(JwtAuthGuard)
  @Get('patient/:patientId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener dispositivo de un paciente' })
  @ApiResponse({ status: 200, description: 'Dispositivo encontrado' })
  async findByPatient(@Param('patientId') patientId: string) {
    return this.devicesService.findByPatient(+patientId);
  }

  @Post('auto-register')
  @ApiOperation({ summary: 'Auto-registro de dispositivo ESP32' })
  @ApiResponse({ status: 201, description: 'Dispositivo registrado/actualizado' })
  async autoRegister(@Body() dto: RegisterDeviceDto) {
    return this.devicesService.upsertFromEsp32(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('vincular')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Vincular dispositivo a un paciente',
    description:
      'Asigna el patient_id y responsible_caregiver_id al dispositivo. Después envía la config por MQTT.',
  })
  @ApiBody({ type: LinkDeviceDto })
  @ApiResponse({ status: 200, description: 'Dispositivo vinculado y config enviada' })
  @ApiResponse({ status: 404, description: 'Dispositivo no encontrado' })
  async linkDevice(@Body() dto: LinkDeviceDto) {
    const result = await this.devicesService.linkToPatient(dto);
    return { vinculado: true, device: result };
  }

  @UseGuards(JwtAuthGuard)
  @Post('command')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Enviar comando MQTT a un dispositivo',
    description: 'Envía una acción al ESP32 (ALARMA_TOMA, CANCELAR_SOS, etc.)',
  })
  @ApiBody({ type: SendCommandDto })
  @ApiResponse({ status: 200, description: 'Comando enviado' })
  async sendCommand(@Body() dto: SendCommandDto) {
    await this.devicesService.sendCommand(dto.deviceId, dto.accion, dto.payload);
    return { enviado: true, deviceId: dto.deviceId, accion: dto.accion };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/responsible')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar responsable del pastillero',
    description: 'Solo el responsable actual puede transferir. Requiere que el nuevo cuidador esté vinculado al paciente.',
  })
  @ApiBody({ type: UpdateResponsibleDto })
  async updateResponsible(
    @Param('id') id: string,
    @Body() dto: UpdateResponsibleDto,
    @GetVitalId() vitalId: string,
  ) {
    const updated = await this.devicesService.updateResponsible(+id, dto.responsibleCaregiverId, vitalId);
    return { actualizado: true, device: updated };
  }

  // ═══════════════════════════════════════════════════════════
  // MQTT LISTENERS (ESP32 → Backend)
  // ═══════════════════════════════════════════════════════════

  @MessagePattern('vitalguard/+/registro')
  async handleMqttRegister(@Payload() dto: RegisterDeviceDto) {
    this.logger(`📩 [MQTT Register]: ${dto.deviceId}`);
    return this.devicesService.upsertFromEsp32(dto);
  }

  @MessagePattern('vitalguard/+/status')
  async handleMqttStatus(@Payload() data: { deviceId: string; wifi: boolean }) {
    this.logger(`💓 [MQTT Status] ${data.deviceId}: Online=${data.wifi}`);
    return this.devicesService.updateStatus(data.deviceId, data.wifi);
  }

  @MessagePattern('vitalguard/+/evento')
  async handleMqttEvent(
    @Payload()
    data: {
      tipo: string;
      deviceId: string;
      timestamp?: string;
      compartimento?: number;
      compartment?: number;
      dosisId?: number;
      horario?: string;
    },
  ) {
    this.logger(`📌 [MQTT Evento] ${data.deviceId}: ${data.tipo}`);

    const statusMap: Record<string, keyof typeof import('@prisma/client').log_status> = {
      TOMA_CONFIRMADA: 'Confirmado',
      CONFIRMACION_TOMA: 'Confirmado',
      TOMA_RETRASO: 'Retraso',
    };

    const mappedStatus = statusMap[data.tipo];
    if (mappedStatus) {
      await this.devicesService.handleTomaConfirmada(
        data.deviceId,
        mappedStatus,
        data.dosisId,
        data.horario,
      );
      return;
    }

    // Eventos de compartimento: COMPARTIMENTO_ABIERTO / COMPARTIMENTO_CERRADO
    const compartimentoRaw = data.compartimento ?? data.compartment;
    if (
      (data.tipo === 'COMPARTIMENTO_ABIERTO' || data.tipo === 'COMPARTIMENTO_CERRADO') &&
      compartimentoRaw != null
    ) {
      const n = Number(compartimentoRaw);
      if (!Number.isNaN(n) && n > 0) {
        await this.devicesService.handleCompartmentEvent(data.deviceId, n, data.tipo);
      }
      return;
    }
  }

  @MessagePattern('vitalguard/+/alerta')
  async handleMqttAlert(
    @Payload() data: { tipo: string; deviceId: string; timestamp?: string },
  ) {
    this.logger(`🚨 [MQTT Alerta] ${data.deviceId}: ${data.tipo}`);

    if (data.tipo === 'SOS') {
      await this.devicesService.handleSosAlert(data.deviceId);
    }
  }

  @MessagePattern('vitalguard/+/solicitar_config')
  async handleSolicitarConfig(
    @Payload() data: any,
    @Ctx() context?: MqttContext,
  ) {
    let rawId: string | null = null;

    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        rawId = parsed?.deviceId ?? parsed?.device_id ?? null;
      } catch {
        rawId = data;
      }
    } else if (data && typeof data === 'object') {
      rawId = data.deviceId ?? data.device_id ?? data.deviceID ?? null;
    }

    if (!rawId && context) {
      try {
        const topic = context.getTopic?.() ?? (context as any)?.topic ?? '';
        const match = topic.match(/vitalguard\/([^/]+)\/solicitar_config/);
        if (match) rawId = match[1];
      } catch {}
    }

    if (!rawId) {
      this.logger(`⚠️ [solicitar_config] payload sin deviceId: ${JSON.stringify(data)?.slice(0, 200)}`);
      return;
    }

    this.logger(`🔄 [solicitar_config] ${rawId} -> resincronizando config`);
    await this.devicesService.handleSolicitarConfig(rawId);
  }

  private logger(msg: string) {
    console.log(`[DevicesController] ${msg}`);
  }
}

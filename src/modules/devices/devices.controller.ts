import {
  Controller,
  Get,
  Post,
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
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LinkDeviceDto } from './dto/link-device.dto';
import { SendCommandDto } from './dto/device-command.dto';

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
  async findByPatient(@GetVitalId() vitalId: string, @Param('patientId') patientId: string) {
    return this.devicesService.findByPatient(vitalId, +patientId);
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
    @Payload() data: { tipo: string; deviceId: string; timestamp?: string },
  ) {
    this.logger(`📌 [MQTT Evento] ${data.deviceId}: ${data.tipo}`);

    if (data.tipo === 'TOMA_CONFIRMADA') {
      await this.devicesService.handleTomaConfirmada(data.deviceId);
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

  private logger(msg: string) {
    console.log(`[DevicesController] ${msg}`);
  }
}

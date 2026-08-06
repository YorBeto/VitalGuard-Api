import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LinkDeviceDto } from './dto/link-device.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // ==========================================
  // METODOS HTTP REST (Para la App Móvil y Fallback)
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('patient/:patientId')
  async findByPatient(@Param('patientId') patientId: string) {
    return this.devicesService.findByPatient(+patientId);
  }

  @Post('auto-register')
  async autoRegister(@Body() dto: RegisterDeviceDto) {
    return this.devicesService.upsertFromEsp32(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('vincular')
  async linkDevice(@Body() dto: LinkDeviceDto) {
    const result = await this.devicesService.linkToPatient(dto);
    return {
      vinculado: true,
      device: result,
    };
  }
  // ==========================================
  // LISTENERS MQTT (Para el ESP32)
  // ==========================================

  /**
   * Escucha: vitalguard/+/registro
   * Payload: {"deviceId":"00LNX1", "firmwareVersion":"1.0.0"}
   */
  @MessagePattern('vitalguard/+/registro')
  async handleMqttRegister(@Payload() dto: RegisterDeviceDto) {
    console.log('📩 [MQTT Register]: Registrando dispositivo...', dto);
    return this.devicesService.upsertFromEsp32(dto);
  }

  /**
   * Escucha: vitalguard/+/status
   * Payload: {"deviceId":"00LNX1", "wifi":true}
   */
  @MessagePattern('vitalguard/+/status')
  async handleMqttStatus(@Payload() data: { deviceId: string; wifi: boolean }) {
    console.log(`💓 [MQTT Heartbeat] ${data.deviceId}: Online=${data.wifi}`);
    return this.devicesService.updateStatus(data.deviceId, data.wifi);
  }

  /**
   * Escucha: vitalguard/+/evento
   * Payload: {"tipo":"DEVICE_ONLINE", "deviceId":"00LNX1", ...}
   */
  @MessagePattern('vitalguard/+/evento')
  async handleMqttEvent(@Payload() data: { tipo: string; deviceId: string; detalle?: string }) {
    console.log(`📌 [MQTT Evento] ${data.deviceId}: ${data.tipo}`);
  }
}
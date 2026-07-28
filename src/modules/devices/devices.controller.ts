import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get('patient/:patientId')
  async findByPatient(@Param('patientId') patientId: string) {
    return this.devicesService.findByPatient(+patientId);
  }
}

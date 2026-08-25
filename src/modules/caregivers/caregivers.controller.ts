import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CaregiversService } from './caregivers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@Controller('caregivers')
@UseGuards(JwtAuthGuard)
export class CaregiversController {
  constructor(private readonly caregiversService: CaregiversService) {}

  @Get('patient/:patientId')
  async findByPatient(@GetVitalId() vitalId: string, @Param('patientId') patientId: string) {
    return this.caregiversService.findByPatient(vitalId, +patientId);
  }
}

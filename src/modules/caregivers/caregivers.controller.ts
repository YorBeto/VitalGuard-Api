import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { CaregiversService } from './caregivers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('caregivers')
@UseGuards(JwtAuthGuard)
export class CaregiversController {
  constructor(private readonly caregiversService: CaregiversService) {}

  @Get('patient/:patientId')
  async findByPatient(@Param('patientId') patientId: string) {
    return this.caregiversService.findByPatient(+patientId);
  }

  @Patch(':id/priority')
  async updatePriority(@Param('id') id: string, @Body('priority') priority: number) {
    return this.caregiversService.updatePriority(+id, priority);
  }
}

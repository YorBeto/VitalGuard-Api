import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('schedules')
@UseGuards(JwtAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get('today/:patientId')
  async findToday(@Param('patientId') patientId: string) {
    return this.schedulesService.findToday(+patientId);
  }
}

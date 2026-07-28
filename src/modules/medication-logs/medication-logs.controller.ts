import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { MedicationLogsService } from './medication-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('medication-logs')
@UseGuards(JwtAuthGuard)
export class MedicationLogsController {
  constructor(private readonly medicationLogsService: MedicationLogsService) {}

  @Get('recent/:patientId')
  async findRecent(@Param('patientId') patientId: string) {
    return this.medicationLogsService.findRecent(+patientId);
  }

  @Get('adherence/:patientId')
  async getAdherence(@Param('patientId') patientId: string) {
    return this.medicationLogsService.getAdherence(+patientId);
  }
}

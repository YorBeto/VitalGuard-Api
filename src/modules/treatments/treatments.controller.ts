import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TreatmentsService } from './treatments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('treatments')
@UseGuards(JwtAuthGuard)
export class TreatmentsController {
  constructor(private readonly treatmentsService: TreatmentsService) {}

  @Get('patient/:patientId')
  async findByPatient(@Param('patientId') patientId: string) {
    return this.treatmentsService.findByPatient(+patientId);
  }

  @Get('active/:patientId')
  async findActive(@Param('patientId') patientId: string) {
    return this.treatmentsService.findActive(+patientId);
  }
}

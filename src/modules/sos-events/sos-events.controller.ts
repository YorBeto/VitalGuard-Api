import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { SosEventsService } from './sos-events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@Controller('sos-events')
@UseGuards(JwtAuthGuard)
export class SosEventsController {
  constructor(private readonly sosEventsService: SosEventsService) {}

  @Get('active/:patientId')
  async findActive(@Param('patientId') patientId: string) {
    return this.sosEventsService.findActive(+patientId);
  }

  @Get('recent/:patientId')
  async findRecent(@Param('patientId') patientId: string) {
    return this.sosEventsService.findRecent(+patientId);
  }

  @Post()
  async create(@Body() body: { patientId: number }) {
    return this.sosEventsService.create(body.patientId);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'Atendido' | 'Falsa_Alarma' },
    @GetVitalId() vitalId: string,
  ) {
    return this.sosEventsService.updateStatus(+id, body.status, vitalId);
  }
}

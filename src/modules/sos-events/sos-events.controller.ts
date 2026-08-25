import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { SosEventsService } from './sos-events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@Controller('sos-events')
@UseGuards(JwtAuthGuard)
export class SosEventsController {
  constructor(private readonly sosEventsService: SosEventsService) {}

  @Get('active/:patientId')
  async findActive(@GetVitalId() vitalId: string, @Param('patientId') patientId: string) {
    return this.sosEventsService.findActive(vitalId, +patientId);
  }

  @Post()
  async create(@GetVitalId() vitalId: string, @Body() body: { patientId: number }) {
    return this.sosEventsService.create(vitalId, body.patientId);
  }
}

import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { SosEventsService } from './sos-events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('sos-events')
@UseGuards(JwtAuthGuard)
export class SosEventsController {
  constructor(private readonly sosEventsService: SosEventsService) {}

  @Get('active/:patientId')
  async findActive(@Param('patientId') patientId: string) {
    return this.sosEventsService.findActive(+patientId);
  }

  @Post()
  async create(@Body() body: { patientId: number }) {
    return this.sosEventsService.create(body.patientId);
  }
}

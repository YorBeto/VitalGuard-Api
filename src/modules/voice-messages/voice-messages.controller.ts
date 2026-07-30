import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { VoiceMessagesService } from './voice-messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('voice-messages')
@UseGuards(JwtAuthGuard)
export class VoiceMessagesController {
  constructor(private readonly voiceMessagesService: VoiceMessagesService) {}

  @Get('patient/:patientId')
  async findByPatient(@Param('patientId') patientId: string) {
    return this.voiceMessagesService.findByPatient(+patientId);
  }
}

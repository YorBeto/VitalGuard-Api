import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { VoiceMessagesService } from './voice-messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@Controller('voice-messages')
@UseGuards(JwtAuthGuard)
export class VoiceMessagesController {
  constructor(private readonly voiceMessagesService: VoiceMessagesService) {}

  @Get('patient/:patientId')
  async findByPatient(@GetVitalId() vitalId: string, @Param('patientId') patientId: string) {
    return this.voiceMessagesService.findByPatient(vitalId, +patientId);
  }
}

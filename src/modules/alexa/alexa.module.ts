import { Module } from '@nestjs/common';

import { AlexaController } from './alexa.controller';
import { AlexaService } from './alexa.service';
import { AlexaIdentityService } from './alexa-identity.service';
import { AlexaResolverService } from './alexa-resolver.service';
import { AiModule } from '../ai/ai.module';
import { SosEventsModule } from '../sos-events/sos-events.module';

@Module({
  imports: [AiModule, SosEventsModule],
  controllers: [AlexaController],
  providers: [AlexaService, AlexaIdentityService, AlexaResolverService],
})
export class AlexaModule {}
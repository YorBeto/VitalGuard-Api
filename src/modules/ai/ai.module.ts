import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { AiController } from './ai.controller';
import { PatientsModule } from '../patients/patients.module';
import { TreatmentsModule } from '../treatments/treatments.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { DevicesModule } from '../devices/devices.module';
import { SosEventsModule } from '../sos-events/sos-events.module';

@Module({
  imports: [
    PatientsModule,
    TreatmentsModule,
    SchedulesModule,
    DevicesModule,
    SosEventsModule,
  ],
  providers: [GeminiService, AiOrchestratorService],
  exports: [GeminiService, AiOrchestratorService],
  controllers: [AiController],
})
export class AiModule {}

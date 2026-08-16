import { Module } from '@nestjs/common';
import { SosEventsService } from './sos-events.service';
import { SosEventsController } from './sos-events.controller';

@Module({
  providers: [SosEventsService],
  controllers: [SosEventsController],
  exports: [SosEventsService],
})
export class SosEventsModule {}

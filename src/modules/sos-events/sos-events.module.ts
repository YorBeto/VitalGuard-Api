import { Module } from '@nestjs/common';
import { SosEventsService } from './sos-events.service';
import { SosEventsController } from './sos-events.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [SosEventsService],
  controllers: [SosEventsController],
  exports: [SosEventsService],
})
export class SosEventsModule {}

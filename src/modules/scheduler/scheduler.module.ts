import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}

import { Module, forwardRef } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TreatmentsModule } from '../treatments/treatments.module';

@Module({
  imports: [NotificationsModule, forwardRef(() => TreatmentsModule)],
  providers: [SchedulerService],
})
export class SchedulerModule {}

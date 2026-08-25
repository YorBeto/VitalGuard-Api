import { Module } from '@nestjs/common';
import { TreatmentsService } from './treatments.service';
import { TreatmentsController } from './treatments.controller';
import { DevicesModule } from '../devices/devices.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  providers: [TreatmentsService],
  controllers: [TreatmentsController],
  imports: [DevicesModule, NotificationsModule],
  exports: [TreatmentsService],
})
export class TreatmentsModule {}

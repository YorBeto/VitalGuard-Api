import { Module } from '@nestjs/common';
import { MedicationLogsService } from './medication-logs.service';
import { MedicationLogsController } from './medication-logs.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [MedicationLogsService],
  controllers: [MedicationLogsController],
  exports: [MedicationLogsService],
})
export class MedicationLogsModule {}

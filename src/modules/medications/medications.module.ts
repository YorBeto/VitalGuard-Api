import { Module } from '@nestjs/common';
import { MedicationsService } from './medications.service';
import { MedicationsController } from './medications.controller';
import { NotificationsModule } from '../notifications/notifications.module'; 

@Module({
  imports: [NotificationsModule], 
  controllers: [MedicationsController],
  providers: [MedicationsService],
})
export class MedicationsModule {}
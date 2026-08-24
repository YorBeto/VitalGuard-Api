import { Module } from '@nestjs/common';
import { TreatmentDetailsService } from './treatment-details.service';
import { TreatmentDetailsController } from './treatment-details.controller';
import { DevicesModule } from '../devices/devices.module';
@Module({
  providers: [TreatmentDetailsService],
  controllers: [TreatmentDetailsController],
  imports: [DevicesModule],
  exports: [TreatmentDetailsService],
})
export class TreatmentDetailsModule {}

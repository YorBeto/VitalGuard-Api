import { Module } from '@nestjs/common';
import { TreatmentDetailsService } from './treatment-details.service';
import { TreatmentDetailsController } from './treatment-details.controller';

@Module({
  providers: [TreatmentDetailsService],
  controllers: [TreatmentDetailsController],
})
export class TreatmentDetailsModule {}

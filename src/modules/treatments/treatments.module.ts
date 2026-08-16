import { Module } from '@nestjs/common';
import { TreatmentsService } from './treatments.service';
import { TreatmentsController } from './treatments.controller';

@Module({
  providers: [TreatmentsService],
  controllers: [TreatmentsController],
  exports: [TreatmentsService],
})
export class TreatmentsModule {}

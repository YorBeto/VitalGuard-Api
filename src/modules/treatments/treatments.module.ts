import { Module } from '@nestjs/common';
import { TreatmentsService } from './treatments.service';
import { TreatmentsController } from './treatments.controller';
import {DevicesModule} from "../devices/devices.module";

@Module({
  providers: [TreatmentsService],
  controllers: [TreatmentsController],
  imports: [DevicesModule],
  exports: [TreatmentsService],
})
export class TreatmentsModule {}

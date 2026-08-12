import { Module } from '@nestjs/common';
import { MedicationLogsService } from './medication-logs.service';
import { MedicationLogsController } from './medication-logs.controller';

@Module({
  providers: [MedicationLogsService],
  controllers: [MedicationLogsController],
  exports: [MedicationLogsService],
})
export class MedicationLogsModule {}

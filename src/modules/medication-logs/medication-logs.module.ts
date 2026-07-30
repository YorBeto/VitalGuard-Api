import { Module } from '@nestjs/common';
import { MedicationLogsService } from './medication-logs.service';
import { MedicationLogsController } from './medication-logs.controller';

@Module({
  providers: [MedicationLogsService],
  controllers: [MedicationLogsController],
})
export class MedicationLogsModule {}

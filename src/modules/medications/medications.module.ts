import { Module } from '@nestjs/common';
import { MedicationsService } from './medications.service';

@Module({
  providers: [MedicationsService],
  exports: [MedicationsService],
})
export class MedicationsModule {}

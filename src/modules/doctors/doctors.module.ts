import { Module } from '@nestjs/common';
import { DoctorsService } from './doctors.service';

@Module({
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}

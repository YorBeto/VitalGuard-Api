import { Module } from '@nestjs/common';
import { DoctorsService } from '../doctors/doctors.service';
import { DoctorsController } from '../doctors/doctors.controller';

@Module({
  providers: [DoctorsService],
  controllers: [DoctorsController],
})
export class DoctorsModule {}
import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [PrismaModule, DevicesModule],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
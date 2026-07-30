import { Module } from '@nestjs/common';
import { CaregiversService } from './caregivers.service';
import { CaregiversController } from './caregivers.controller';

@Module({
  providers: [CaregiversService],
  controllers: [CaregiversController],
})
export class CaregiversModule {}

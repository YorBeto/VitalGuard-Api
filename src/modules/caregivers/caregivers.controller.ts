import { Controller } from '@nestjs/common';
import { CaregiversService } from './caregivers.service';

@Controller('caregivers')
export class CaregiversController {
  constructor(private readonly caregiversService: CaregiversService) {}
}

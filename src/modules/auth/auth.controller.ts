import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('check-status')
  @UseGuards(JwtAuthGuard)
  async checkStatus(@GetVitalId() vitalId: string) {
    return this.authService.checkUserStatus(vitalId);
  }
}
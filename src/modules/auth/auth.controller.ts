import { Controller, Get, Post, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('dev-login')
  async devLogin(@Body('vitalId') vitalId?: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('dev-login no está disponible en producción');
    }
    return this.authService.devLogin(vitalId);
  }

  @Get('check-status')
  @UseGuards(JwtAuthGuard)
  async checkStatus(@GetVitalId() vitalId: string) {
    return this.authService.checkUserStatus(vitalId);
  }
}
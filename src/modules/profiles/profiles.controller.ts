// 1. Agregamos UseGuards a la importación de @nestjs/common
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) { }

  @UseGuards(JwtAuthGuard)
  @Get('status/:vitalId')
  async getStatus(@Param('vitalId') vitalId: string) {
    return await this.profilesService.checkProfileStatus(vitalId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('complete-doctor')
  async completeDoctor(
    @Body() body: { vital_id: string; specialty: string; medical_license: string }
  ) {
    return await this.profilesService.completeDoctorProfile(
      body.vital_id,
      body.specialty,
      body.medical_license,
    );
  }
}
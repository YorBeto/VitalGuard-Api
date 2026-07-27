// src/modules/app-profiles/app-profiles.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AppProfilesService } from './app-profiles.service';
import { OnboardingDto, OnboardingRole } from './dto/create-onboarding.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@ApiTags('App Profiles (Onboarding)')
@ApiBearerAuth()
@Controller('app-profiles')
@UseGuards(JwtAuthGuard)
export class AppProfilesController {
  constructor(private readonly appProfilesService: AppProfilesService) {}

  @Post('onboarding')
  @ApiOperation({
    summary: 'Completar Onboarding en la App Móvil (Pantalla 44/44b)',
    description:
      'Registra al usuario en VitalGuard definiendo su modo de uso. Si elige CAREGIVER, solo crea su perfil de cuidador. Si elige PATIENT (Autocuidado), crea el perfil de cuidador, la ficha médica del paciente y los vincula automáticamente.',
  })
  @ApiBody({
    type: OnboardingDto,
    examples: {
      autocuidado: {
        summary: 'Caso 1: Cuidarme a mí (Autocuidado)',
        value: {
          role: OnboardingRole.PATIENT,
          patientData: {
            bloodType: 'O_POSITIVE',
            medicalNotes: 'Alergia a la penicilina, presión arterial bajo control',
          },
        },
      },
      cuidador: {
        summary: 'Caso 2: Cuidar a alguien (Cuidador Puro)',
        value: {
          role: OnboardingRole.CAREGIVER,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Onboarding completado exitosamente',
    schema: {
      example: {
        message: 'Onboarding completado exitosamente (Modo Autocuidado)',
        appProfileId: 1,
        caregiverId: 1,
        patientId: 1,
        isSelfCare: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Datos faltantes o valores de enum inválidos (ej. tipo de sangre incorrecto)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Token JWT no válido o expirado',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict - El usuario ya completó el onboarding previamente en VitalGuard',
  })
  async onboarding(
    @GetVitalId() vitalId: string,
    @Req() req: any,
    @Body() dto: OnboardingDto,
  ) {
    return this.appProfilesService.completeOnboarding(vitalId, req.user, dto);
  }
}
import { invitee_role, kinship_type } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateInvitationDto {
  @ApiPropertyOptional({
    example: 'c0c8f1e2-0000-0000-0000-000000000000',
    description:
      'Vital ID del invitado si ya es usuario de VitalGuard. Requerido si no se envía inviteeEmail.',
  })
  @IsUUID()
  @IsOptional()
  inviteeVitalId?: string;

  @ApiPropertyOptional({
    example: 'familia@correo.com',
    description:
      'Email del invitado si aún no tiene cuenta en VitalGuard. Requerido si no se envía inviteeVitalId.',
  })
  @IsEmail()
  @IsOptional()
  inviteeEmail?: string;

  @ApiPropertyOptional({
    enum: invitee_role,
    example: 'CAREGIVER',
    description: 'Rol al que se invita (por defecto CAREGIVER).',
  })
  @IsEnum(invitee_role)
  @IsOptional()
  inviteeRole?: invitee_role;

  @ApiPropertyOptional({
    enum: kinship_type,
    example: 'Padre',
    description: 'Parentesco del invitado con el paciente.',
  })
  @IsEnum(kinship_type)
  @IsOptional()
  kinship?: kinship_type;

  @ApiPropertyOptional({
    example: 'Papá, te invito a cuidar a la abuela.',
    description: 'Mensaje opcional personalizado para el invitado.',
  })
  @IsString()
  @IsOptional()
  message?: string;
}

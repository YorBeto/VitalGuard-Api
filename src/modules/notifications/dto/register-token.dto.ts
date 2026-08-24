import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterTokenDto {
  @ApiProperty({
    example: 'fcm_token_abc123',
    description: 'Token FCM del dispositivo móvil',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    example: 'android',
    description: 'Plataforma del dispositivo (android, ios)',
  })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({
    example: 'cuidador@correo.com',
    description: 'Email del usuario (fallback si el JWT no trae email, para vincular invitaciones por correo)',
  })
  @IsString()
  @IsOptional()
  email?: string;
}

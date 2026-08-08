import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { log_status } from '@prisma/client';

export class CreateMedicationLogDto {
  @ApiProperty({ example: 1, description: 'ID del schedule' })
  @IsInt()
  @IsNotEmpty({ message: 'El ID del schedule es obligatorio' })
  scheduleId!: number;

  @ApiProperty({ example: '2026-08-06T08:00:00', description: 'Fecha/hora programada (ISO)' })
  @IsDateString()
  @IsNotEmpty({ message: 'La fecha programada es obligatoria' })
  scheduledDatetime!: string;
}

export class UpdateMedicationLogDto {
  @ApiPropertyOptional({
    enum: log_status,
    example: 'Confirmado',
    description: 'Estado de la toma',
  })
  @IsEnum(log_status, { message: 'Estado inválido' })
  @IsOptional()
  status?: log_status;

  @ApiPropertyOptional({ example: '2026-08-06T08:05:00', description: 'Fecha/hora real de toma (ISO)' })
  @IsDateString()
  @IsOptional()
  actualTakenDatetime?: string;

  @ApiPropertyOptional({ example: true, description: 'Confirmación por voz' })
  @IsOptional()
  voiceConfirmed?: boolean;
}

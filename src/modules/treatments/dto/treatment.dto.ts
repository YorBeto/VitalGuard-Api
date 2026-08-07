import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { treatment_status } from '@prisma/client';

export class CreateTreatmentDto {
  @ApiProperty({ example: 1, description: 'ID del paciente' })
  @IsInt()
  @IsNotEmpty({ message: 'El ID del paciente es obligatorio' })
  patientId!: number;

  @ApiProperty({ example: '2026-08-01', description: 'Fecha de inicio (ISO date)' })
  @IsDateString({}, { message: 'La fecha debe estar en formato ISO' })
  @IsNotEmpty({ message: 'La fecha de inicio es obligatoria' })
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Fecha de fin (ISO date)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    enum: treatment_status,
    example: 'Activo',
    description: 'Estado del tratamiento',
  })
  @IsEnum(treatment_status)
  @IsOptional()
  status?: treatment_status;
}

export class UpdateTreatmentDto {
  @ApiPropertyOptional({ example: '2026-12-31', description: 'Fecha de fin (ISO date)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    enum: treatment_status,
    example: 'Pausado',
    description: 'Estado del tratamiento',
  })
  @IsEnum(treatment_status, { message: 'Estado inválido' })
  @IsOptional()
  status?: treatment_status;
}

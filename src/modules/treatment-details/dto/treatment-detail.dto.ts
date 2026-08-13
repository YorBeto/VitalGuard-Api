import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { medication_status } from '@prisma/client';

export class CreateTreatmentDetailDto {
  @ApiProperty({ example: 1, description: 'ID del tratamiento' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsNotEmpty({ message: 'El ID del tratamiento es obligatorio' })
  treatmentId!: number;

  @ApiProperty({ example: 1, description: 'ID del medicamento' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsNotEmpty({ message: 'El ID del medicamento es obligatorio' })
  medicationId!: number;

  @ApiPropertyOptional({ example: '1 tableta', description: 'Información de dosis' })
  @IsString()
  @IsOptional()
  doseInfo?: string;

  @ApiPropertyOptional({ example: 8, description: 'Frecuencia en horas' })
  @IsInt()
  @Min(1)
  @Max(72)
  @IsOptional()
  frequencyHours?: number;

  @ApiProperty({ example: '08:00:00', description: 'Hora de la primera toma (HH:mm:ss)' })
  @IsString()
  @IsNotEmpty({ message: 'La hora de primera toma es obligatoria' })
  firstTakeTime!: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Fecha de fin (ISO date)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    enum: medication_status,
    example: 'En_curso',
    description: 'Estado del detalle del tratamiento',
  })
  @IsEnum(medication_status)
  @IsOptional()
  status?: medication_status;

  @ApiPropertyOptional({ example: 1, description: 'Número de compartimento del dispositivo' })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  compartmentNumber?: number;

  @ApiPropertyOptional({ example: false, description: 'Si es medicamento externo' })
  @IsBoolean()
  @IsOptional()
  isExternal?: boolean;
}

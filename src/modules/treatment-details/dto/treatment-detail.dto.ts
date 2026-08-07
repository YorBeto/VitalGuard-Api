import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateTreatmentDetailDto {
  @ApiProperty({ example: 1, description: 'ID del tratamiento' })
  @IsInt()
  @IsNotEmpty({ message: 'El ID del tratamiento es obligatorio' })
  treatmentId!: number;

  @ApiProperty({ example: 1, description: 'ID del medicamento' })
  @IsInt()
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

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class RequestMedicationDto {
  @ApiProperty({ example: 1, description: 'ID del paciente', required: false })
  @IsNumber()
  @IsOptional() 
  patientId?: number;

  @ApiProperty({ example: 15, description: 'ID del tratamiento actual', required: false })
  @IsNumber()
  @IsOptional() 
  treatmentId?: number;

  @ApiProperty({ example: 'Ibuprofeno 800mg', description: 'Nombre del medicamento no encontrado' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del medicamento es obligatorio' })
  medicationName!: string;

  @ApiProperty({ example: 'Cápsulas / 800mg', description: 'Presentación o dosis requerida', required: false })
  @IsString()
  @IsOptional()
  presentation?: string;
}
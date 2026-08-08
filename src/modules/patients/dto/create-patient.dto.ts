import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { blood_type, gender_type } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class CreatePatientDto {
  @ApiProperty({ example: 'María', description: 'Nombre(s) del paciente' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  firstName!: string;

  @ApiProperty({ example: 'García', description: 'Apellido paterno' })
  @IsString()
  @IsNotEmpty({ message: 'El apellido paterno es obligatorio' })
  paternalLastName!: string;

  @ApiProperty({ example: '1945-03-12', description: 'Fecha de nacimiento (ISO)' })
  @IsDateString({}, { message: 'La fecha debe estar en formato ISO' })
  @IsNotEmpty({ message: 'La fecha de nacimiento es obligatoria' })
  birthDate!: string;

  @ApiProperty({ enum: gender_type, example: 'F', description: 'Género del paciente' })
  @IsEnum(gender_type, { message: 'El género debe ser M o F' })
  @IsNotEmpty({ message: 'El género es obligatorio' })
  gender!: gender_type;

  @ApiPropertyOptional({ example: 'López', description: 'Apellido materno' })
  @IsString()
  @IsOptional()
  maternalLastName?: string;

  @ApiPropertyOptional({ example: '5551234567', description: 'Teléfono de contacto' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Calle Olmo #123, Colonia Centro', description: 'Dirección' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    enum: blood_type,
    example: 'O_POSITIVE',
    description: 'Tipo de sangre',
  })
  @IsEnum(blood_type, { message: 'Tipo de sangre inválido' })
  @IsOptional()
  bloodType?: blood_type;

  @ApiPropertyOptional({ example: 'Alergia a la penicilina', description: 'Notas médicas' })
  @IsString()
  @IsOptional()
  medicalNotes?: string;
}

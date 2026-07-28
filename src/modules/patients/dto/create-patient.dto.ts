import { blood_type, gender_type, kinship_type } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class CreatePatientDto {
  @ApiProperty({ example: 'Juan', description: 'Nombre(s) del paciente' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  firstName!: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido paterno del paciente' })
  @IsString()
  @IsNotEmpty({ message: 'El apellido paterno es obligatorio' })
  paternalLastName!: string;

  @ApiPropertyOptional({ example: 'Gómez', description: 'Apellido materno del paciente' })
  @IsString()
  @IsOptional()
  maternalLastName?: string;

  @ApiProperty({ example: '1955-08-15', description: 'Fecha de nacimiento en formato YYYY-MM-DD' })
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener un formato válido (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'La fecha de nacimiento es obligatoria' })
  birthDate!: string;

  @ApiProperty({ enum: gender_type, example: 'M', description: 'Género del paciente (M / F / Otro)' })
  @IsEnum(gender_type, { message: 'El género debe ser un valor válido' })
  @IsNotEmpty({ message: 'El género es obligatorio' })
  gender!: gender_type;

  @ApiPropertyOptional({
    enum: blood_type,
    example: 'O_POSITIVE',
    description: 'Tipo de sangre opcional (ej. O_POSITIVE, A_POSITIVE)',
  })
  @IsEnum(blood_type, { message: 'El tipo de sangre no es válido' })
  @IsOptional()
  bloodType?: blood_type;

  @ApiPropertyOptional({
    example: 'Padre',
    enum: kinship_type,
    description: 'Parentesco con el cuidador (Padre, Madre, Hijo, Abuelo, etc.)',
  })
  @IsEnum(kinship_type, { message: 'El parentesco no es válido' })
  @IsNotEmpty({ message: 'El parentesco es obligatorio' })
  kinship!: kinship_type;

  @ApiPropertyOptional({
    example: 'Hipertensión crónica, alérgico a la penicilina',
    description: 'Notas médicas o antecedentes',
  })
  @IsString()
  @IsOptional()
  medicalNotes?: string;
}
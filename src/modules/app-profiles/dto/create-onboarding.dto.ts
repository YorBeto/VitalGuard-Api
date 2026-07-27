// src/modules/app-profiles/dto/create-onboarding.dto.ts
import { blood_type, gender_type, kinship_type } from '@prisma/client';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  ValidateNested,
  IsObject,
} from 'class-validator';

export enum OnboardingRole {
  PATIENT = 'PATIENT',
  CAREGIVER = 'CAREGIVER',
}

export class PatientDataDto {
  @ApiPropertyOptional({ example: 'Jesus Alberto', description: 'Nombre(s) del paciente (opcional si viene en el JWT)' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Tovar', description: 'Apellido paterno (opcional si viene en el JWT)' })
  @IsString()
  @IsOptional()
  paternalLastName?: string;

  @ApiPropertyOptional({ example: 'Morales', description: 'Apellido materno (opcional)' })
  @IsString()
  @IsOptional()
  maternalLastName?: string;

  @ApiPropertyOptional({ example: '2000-01-01', description: 'Fecha de nacimiento en formato ISO' })
  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @ApiPropertyOptional({ enum: gender_type, example: 'M', description: 'Género del paciente' })
  @IsEnum(gender_type)
  @IsOptional()
  gender?: gender_type;

  @ApiPropertyOptional({ 
    enum: blood_type, 
    example: 'O_POSITIVE', 
    description: 'Tipo de sangre (A_POSITIVE, A_NEGATIVE, B_POSITIVE, B_NEGATIVE, AB_POSITIVE, AB_NEGATIVE, O_POSITIVE, O_NEGATIVE)' 
  })
  @IsEnum(blood_type)
  @IsOptional()
  bloodType?: blood_type;

  @ApiPropertyOptional({ example: 'Alergia a la penicilina, hipertensión bajo control', description: 'Notas médicas o antecedentes' })
  @IsString()
  @IsOptional()
  medicalNotes?: string;
}

export class OnboardingDto {
  @ApiProperty({
    enum: OnboardingRole,
    example: 'PATIENT',
    description: 'Rol seleccionado en la Pantalla 44: PATIENT (Autocuidado) o CAREGIVER (Cuidar a alguien)',
  })
  @IsEnum(OnboardingRole, { message: 'El rol debe ser PATIENT o CAREGIVER' })
  @IsNotEmpty()
  role!: OnboardingRole;

  @ApiPropertyOptional({
    type: PatientDataDto,
    description: 'Datos médicos del paciente. Obligatorio/Recomendado en modo Autocuidado (PATIENT)',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PatientDataDto)
  patientData?: PatientDataDto;

  @ApiPropertyOptional({
    enum: kinship_type,
    example: 'Otro',
    description: 'Parentesco con el paciente (Por defecto "Otro" para autocuidado)',
  })
  @IsEnum(kinship_type)
  @IsOptional()
  kinship?: kinship_type;
}
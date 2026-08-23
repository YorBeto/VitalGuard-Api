import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDoctorDto {
  @IsInt()
  @IsNotEmpty()
  app_profile_id!: number; 

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  specialty!: string; 

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  medical_license!: string; 
}
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class LinkDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string; // "A1B2C3"

  @IsNumber()
  @IsNotEmpty()
  patientId!: number;

  @IsNumber()
  @IsOptional()
  responsibleCaregiverId?: number;
}
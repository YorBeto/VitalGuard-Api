import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string; // Ej: "A1B2C3"

  @IsString()
  @IsOptional()
  firmwareVersion?: string;
}
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class SendCommandDto {
  @ApiProperty({ example: 'A1B2C3', description: 'Código del dispositivo' })
  @IsString()
  @IsNotEmpty({ message: 'El deviceId es obligatorio' })
  deviceId!: string;

  @ApiProperty({ example: 'ALARMA_TOMA', description: 'Acción a ejecutar' })
  @IsString()
  @IsNotEmpty({ message: 'La acción es obligatoria' })
  accion!: string;

  @ApiPropertyOptional({ example: {}, description: 'Datos adicionales del comando' })
  @IsObject()
  @IsOptional()
  payload?: Record<string, any>;
}

export class SendConfigDto {
  @ApiProperty({ example: 'A1B2C3', description: 'Código del dispositivo' })
  @IsString()
  @IsNotEmpty({ message: 'El deviceId es obligatorio' })
  deviceId!: string;

  @ApiProperty({ example: '08:00', description: 'Próxima toma (HH:mm)' })
  @IsString()
  @IsNotEmpty({ message: 'La próxima toma es obligatoria' })
  proximaToma!: string;

  @ApiPropertyOptional({
    example: [{ nombre: 'Losartán', dosis: '50mg', hora: '08:00' }],
    description: 'Lista de medicamentos',
  })
  @IsObject()
  @IsOptional()
  medications?: Record<string, any>[];
}

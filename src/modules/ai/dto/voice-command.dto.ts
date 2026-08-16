import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class VoiceCommandDto {
  @ApiProperty({ example: 1, description: 'ID del paciente sobre el que se interpreta el comando' })
  @IsInt()
  @IsNotEmpty({ message: 'El patientId es obligatorio' })
  patientId!: number;

  @ApiProperty({ example: 'Me siento muy mal', description: 'Comando de voz transcrito por Alexa' })
  @IsString()
  @IsNotEmpty({ message: 'El texto es obligatorio' })
  texto!: string;
}

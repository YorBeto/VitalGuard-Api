import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateScheduleDto {
  @ApiProperty({ example: 1, description: 'ID del treatment_detail' })
  @IsInt()
  @IsNotEmpty({ message: 'El ID del treatment_detail es obligatorio' })
  treatmentDetailId!: number;

  @ApiProperty({ example: '08:00:00', description: 'Hora del día (HH:mm:ss)' })
  @IsString()
  @IsNotEmpty({ message: 'La hora del día es obligatoria' })
  timeOfDay!: string;
}

import { IsNumber, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateResponsibleDto {
  @ApiProperty({ example: 5, description: 'ID del cuidador que será el nuevo responsable' })
  @IsNumber()
  @IsNotEmpty()
  responsibleCaregiverId!: number;
}

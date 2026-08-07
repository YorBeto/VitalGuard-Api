import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class MarkAsReadDto {
  @ApiPropertyOptional({ example: true, description: 'Marcar como leída' })
  @IsBoolean()
  @IsOptional()
  isRead?: boolean = true;
}

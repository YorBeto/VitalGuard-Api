import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SearchMedicationDto {
  @ApiPropertyOptional({
    description: 'Término de búsqueda para filtrar por nombre o presentación (ej: "para", "500 mg")',
    example: 'para',
  })
  @IsString()
  @IsOptional()
  q?: string;
}
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { TreatmentDetailsService } from './treatment-details.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateTreatmentDetailDto } from './dto/treatment-detail.dto';

@ApiTags('Treatment Details (Detalles de Tratamiento)')
@ApiBearerAuth()
@Controller('treatment-details')
@UseGuards(JwtAuthGuard)
export class TreatmentDetailsController {
  constructor(private readonly treatmentDetailsService: TreatmentDetailsService) {}

  @Get('treatment/:treatmentId')
  @ApiOperation({ summary: 'Listar detalles de un tratamiento' })
  @ApiResponse({ status: 200, description: 'Lista de detalles con medicamentos y horarios' })
  async findByTreatment(@Param('treatmentId', ParseIntPipe) treatmentId: number) {
    return this.treatmentDetailsService.findByTreatment(treatmentId);
  }

  @Post()
  @ApiOperation({
    summary: 'Asignar un medicamento a un tratamiento',
    description: 'Crea un detalle de tratamiento con dosis, frecuencia y compartimento.',
  })
  @ApiBody({ type: CreateTreatmentDetailDto })
  @ApiResponse({ status: 201, description: 'Detalle creado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Tratamiento o medicamento no encontrado' })
  async create(@Body() dto: CreateTreatmentDetailDto) {
    return this.treatmentDetailsService.create(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un detalle de tratamiento (soft-delete)' })
  @ApiResponse({ status: 200, description: 'Detalle eliminado' })
  @ApiResponse({ status: 404, description: 'Detalle no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.treatmentDetailsService.remove(id);
  }
}

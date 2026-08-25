import {
  Controller,
  Get,
  Post,
  Patch,
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
import { TreatmentsService } from './treatments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateTreatmentDto, UpdateTreatmentDto } from './dto/treatment.dto';

@ApiTags('Treatments (Tratamientos)')
@ApiBearerAuth()
@Controller('treatments')
@UseGuards(JwtAuthGuard)
export class TreatmentsController {
  constructor(private readonly treatmentsService: TreatmentsService) {}

  @Get('patient/:patientId')
  @ApiOperation({ summary: 'Listar tratamientos de un paciente' })
  @ApiResponse({ status: 200, description: 'Lista de tratamientos' })
  async findByPatient(@Param('patientId', ParseIntPipe) patientId: number) {
    return this.treatmentsService.findByPatient(patientId);
  }

  @Get('active/:patientId')
  @ApiOperation({ summary: 'Obtener tratamiento activo de un paciente' })
  @ApiResponse({ status: 200, description: 'Tratamiento activo con detalles' })
  @ApiResponse({ status: 404, description: 'No hay tratamiento activo' })
  async findActive(@Param('patientId', ParseIntPipe) patientId: number) {
    return this.treatmentsService.findActive(patientId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un tratamiento para un paciente' })
  @ApiBody({ type: CreateTreatmentDto })
  @ApiResponse({ status: 201, description: 'Tratamiento creado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Paciente no encontrado' })
  async create(@Body() dto: CreateTreatmentDto) {
    return this.treatmentsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar estado o fecha de fin de un tratamiento' })
  @ApiBody({ type: UpdateTreatmentDto })
  @ApiResponse({ status: 200, description: 'Tratamiento actualizado' })
  @ApiResponse({ status: 404, description: 'Tratamiento no encontrado' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTreatmentDto,
  ) {
    return this.treatmentsService.update(id, dto);
  }

  @Post(':id/finalize')
  @ApiOperation({ summary: 'Finalizar un tratamiento (libera compartimentos y actualiza MQTT)' })
  @ApiResponse({ status: 200, description: 'Tratamiento finalizado' })
  @ApiResponse({ status: 404, description: 'Tratamiento no encontrado' })
  async finalize(@Param('id', ParseIntPipe) id: number) {
    return this.treatmentsService.finalize(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un tratamiento (soft-delete en cascada)' })
  @ApiResponse({ status: 200, description: 'Tratamiento eliminado' })
  @ApiResponse({ status: 404, description: 'Tratamiento no encontrado' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.treatmentsService.remove(id);
  }
}

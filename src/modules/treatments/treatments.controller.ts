import {
  Controller,
  Get,
  Post,
  Patch,
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
import { GetVitalId } from '../../common/decorators/get-user.decorator';
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
  async findByPatient(
    @GetVitalId() vitalId: string,
    @Param('patientId', ParseIntPipe) patientId: number,
  ) {
    return this.treatmentsService.findByPatient(vitalId, patientId);
  }

  @Get('active/:patientId')
  @ApiOperation({ summary: 'Obtener tratamiento activo de un paciente' })
  @ApiResponse({ status: 200, description: 'Tratamiento activo con detalles' })
  @ApiResponse({ status: 404, description: 'No hay tratamiento activo' })
  async findActive(
    @GetVitalId() vitalId: string,
    @Param('patientId', ParseIntPipe) patientId: number,
  ) {
    return this.treatmentsService.findActive(vitalId, patientId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un tratamiento para un paciente' })
  @ApiBody({ type: CreateTreatmentDto })
  @ApiResponse({ status: 201, description: 'Tratamiento creado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Paciente no encontrado' })
  async create(@GetVitalId() vitalId: string, @Body() dto: CreateTreatmentDto) {
    return this.treatmentsService.create(vitalId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar estado o fecha de fin de un tratamiento' })
  @ApiBody({ type: UpdateTreatmentDto })
  @ApiResponse({ status: 200, description: 'Tratamiento actualizado' })
  @ApiResponse({ status: 404, description: 'Tratamiento no encontrado' })
  async update(
    @GetVitalId() vitalId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTreatmentDto,
  ) {
    return this.treatmentsService.update(vitalId, id, dto);
  }
}

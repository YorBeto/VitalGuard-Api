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
import { MedicationLogsService } from './medication-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';
import {
  CreateMedicationLogDto,
  UpdateMedicationLogDto,
} from './dto/medication-log.dto';

@ApiTags('Medication Logs (Logs de Medicación)')
@ApiBearerAuth()
@Controller('medication-logs')
@UseGuards(JwtAuthGuard)
export class MedicationLogsController {
  constructor(private readonly medicationLogsService: MedicationLogsService) {}

  @Get('recent/:patientId')
  @ApiOperation({ summary: 'Logs recientes de medicación de un paciente' })
  @ApiResponse({ status: 200, description: 'Lista de logs ordenados por fecha' })
  async findRecent(@Param('patientId', ParseIntPipe) patientId: number) {
    return this.medicationLogsService.findRecent(patientId);
  }

  @Get('adherence/:patientId')
  @ApiOperation({ summary: 'Calcular adherencia medicosa de un paciente' })
  @ApiResponse({ status: 200, description: 'Porcentaje de adherencia' })
  async getAdherence(@Param('patientId', ParseIntPipe) patientId: number) {
    return this.medicationLogsService.getAdherence(patientId);
  }

  @Post()
  @ApiOperation({
    summary: 'Registrar que llegó la hora de una dosis',
    description: 'Crea un medication_log en estado Pendiente para un schedule dado.',
  })
  @ApiBody({ type: CreateMedicationLogDto })
  @ApiResponse({ status: 201, description: 'Log creado (Pendiente)' })
  @ApiResponse({ status: 404, description: 'Schedule no encontrado' })
  async create(
    @Body() dto: CreateMedicationLogDto,
    @GetVitalId() vitalId: string,
  ) {
    return this.medicationLogsService.create(dto, vitalId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar estado de una dosis',
    description:
      'Permite confirmar (Confirmado), marcar retraso (Retraso) u omitida (Omitida).',
  })
  @ApiBody({ type: UpdateMedicationLogDto })
  @ApiResponse({ status: 200, description: 'Log actualizado' })
  @ApiResponse({ status: 404, description: 'Log no encontrado' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMedicationLogDto,
    @GetVitalId() vitalId: string,
  ) {
    return this.medicationLogsService.update(id, dto, vitalId);
  }
}

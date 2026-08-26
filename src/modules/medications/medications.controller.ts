import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Param
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MedicationsService } from './medications.service';
import { SearchMedicationDto } from './dto/search-medication.dto';
import { RequestMedicationDto } from './dto/request-medication.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@ApiTags('Medications (Medicamentos)')
@ApiBearerAuth()
@Controller('medications')
@UseGuards(JwtAuthGuard)
export class MedicationsController {
  constructor(private readonly medicationsService: MedicationsService) {}

  @Get()
  @ApiOperation({ summary: 'Buscar medicamentos en el catálogo general (Autocompletar)' })
  @ApiResponse({ status: 200, description: 'Lista de medicamentos que coinciden con la búsqueda' })
  async findAll(@Query() queryDto: SearchMedicationDto) {
    return this.medicationsService.findAll(queryDto.q);
  }

  @Post('request')
  @ApiOperation({
    summary: 'Solicitar agregar un medicamento no encontrado en el catálogo',
    description:
      'Genera una notificación directa para el médico tratante del paciente o la dirige a soporte/administrador en caso de no tener médico asignado.',
  })
  @ApiResponse({
    status: 201,
    description: 'Solicitud registrada y notificación enviada exitosamente',
  })
  async requestMedication(
    @GetVitalId() vitalId: string,
    @Body() dto: RequestMedicationDto,
  ) {
    return this.medicationsService.requestMedication(vitalId, dto);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Listar solicitudes pendientes de medicamentos' })
  async getRequests(@GetVitalId() vitalId: string) {
    return this.medicationsService.getPendingRequests(vitalId); 
  }

  @Post('requests/:id/approve')
  @ApiOperation({ summary: 'Aprobar solicitud de medicamento y añadirlo al catálogo' })
  async approveRequest(@Param('id') id: string) {
    return this.medicationsService.approveMedicationRequest(Number(id));
  }
}
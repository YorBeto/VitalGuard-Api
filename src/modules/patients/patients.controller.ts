import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
import { PatientsService } from './patients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

@ApiTags('Patients (Pacientes)')
@ApiBearerAuth()
@Controller('patients')
@UseGuards(JwtAuthGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar pacientes del cuidador autenticado' })
  @ApiResponse({ status: 200, description: 'Lista paginada de pacientes' })
  @ApiResponse({ status: 404, description: 'Perfil de cuidador no encontrado' })
  async findAll(
    @GetVitalId() vitalId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.patientsService.findAllByCaregiver(vitalId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un paciente por ID' })
  @ApiResponse({ status: 200, description: 'Paciente encontrado' })
  @ApiResponse({ status: 403, description: 'Sin acceso a este paciente' })
  @ApiResponse({ status: 404, description: 'Paciente no encontrado' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetVitalId() vitalId: string,
  ) {
    return this.patientsService.findOne(id, vitalId);
  }

  @Post()
  @ApiOperation({
    summary: 'Crear un nuevo paciente',
    description:
      'Crea la ficha médica del paciente y lo vincula al cuidador autenticado.',
  })
  @ApiBody({ type: CreatePatientDto })
  @ApiResponse({ status: 201, description: 'Paciente creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 404, description: 'Perfil de cuidador no encontrado' })
  async create(
    @GetVitalId() vitalId: string,
    @Body() dto: CreatePatientDto,
  ) {
    return this.patientsService.create(vitalId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar datos de un paciente' })
  @ApiBody({ type: UpdatePatientDto })
  @ApiResponse({ status: 200, description: 'Paciente actualizado' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 403, description: 'Sin acceso a este paciente' })
  @ApiResponse({ status: 404, description: 'Paciente no encontrado' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @GetVitalId() vitalId: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientsService.update(id, vitalId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un paciente (soft-delete)' })
  @ApiResponse({ status: 200, description: 'Paciente eliminado' })
  @ApiResponse({ status: 403, description: 'Sin acceso a este paciente' })
  @ApiResponse({ status: 404, description: 'Paciente no encontrado' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @GetVitalId() vitalId: string,
  ) {
    return this.patientsService.remove(id, vitalId);
  }
}

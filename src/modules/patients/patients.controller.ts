import { Controller, Post, Body, UseGuards, Get, Param, ParseIntPipe} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';

@ApiTags('Patients (Pacientes)')
@ApiBearerAuth()
@Controller('patients')
@UseGuards(JwtAuthGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar un nuevo paciente dependiente (Pantalla 14)',
    description:
      'Crea la ficha clínica del paciente y lo vincula automáticamente al Cuidador autenticado en la tabla caregiver_patient con su parentesco.',
  })
  @ApiResponse({
    status: 201,
    description: 'Paciente creado y vinculado correctamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Formato de datos o parentesco inválido',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Token no válido',
  })
  async create(
    @GetVitalId() vitalId: string,
    @Body() dto: CreatePatientDto,
  ) {
    return this.patientsService.createPatient(vitalId, dto);
  }


@Get()
@ApiOperation({
  summary: 'Obtener la lista de pacientes asignados al Cuidador (Dashboard)',
  description:
    'Devuelve el listado completo de pacientes vinculados al usuario autenticado, junto con su parentesco y la información del dispositivo IoT asociado si existe.',
})
@ApiResponse({
  status: 200,
  description: 'Lista de pacientes obtenida correctamente',
  schema: {
    example: [
      {
        relationId: 1,
        kinship: 'Padre',
        patient: {
          id: 1,
          firstName: 'Carlos Alberto',
          paternalLastName: 'Tovar',
          maternalLastName: 'Gómez',
          fullName: 'Carlos Alberto Tovar Gómez',
          birthDate: '1960-05-12T00:00:00.000Z',
          gender: 'M',
          bloodType: 'O_POSITIVE',
          medicalNotes: 'Hipertensión crónica',
        },
        device: {
          id: 1,
          uniqueCode: 'VG12345',
          isOnline: true,
          lastSyncAt: '2026-07-26T15:00:00.000Z',
        },
      },
    ],
  },
})
@ApiResponse({
  status: 401,
  description: 'Unauthorized - Token JWT inválido o expirado',
})
@ApiResponse({
  status: 404,
  description: 'Not Found - Perfil de cuidador no encontrado',
})
async findAll(@GetVitalId() vitalId: string) {
  return this.patientsService.getCaregiverPatients(vitalId);
}

  @Get(':id/summary')
  @ApiOperation({ summary: 'Obtener métricas y resumen de adherencia de un paciente (Tarjetas Detalle Paciente)' })
  async getSummary(@Param('id', ParseIntPipe) id: number) {
    return this.patientsService.getPatientSummary(id);
  }
}
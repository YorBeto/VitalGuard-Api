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
import { SchedulesService } from './schedules.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';
import { CreateScheduleDto } from './dto/schedule.dto';

@ApiTags('Schedules (Horarios)')
@ApiBearerAuth()
@Controller('schedules')
@UseGuards(JwtAuthGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get('today/:patientId')
  @ApiOperation({ summary: 'Horarios de hoy de un paciente' })
  @ApiResponse({ status: 200, description: 'Lista de horarios del día' })
  async findToday(
    @GetVitalId() vitalId: string,
    @Param('patientId', ParseIntPipe) patientId: number,
  ) {
    return this.schedulesService.findToday(vitalId, patientId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un horario para un treatment_detail' })
  @ApiBody({ type: CreateScheduleDto })
  @ApiResponse({ status: 201, description: 'Horario creado' })
  @ApiResponse({ status: 404, description: 'Treatment detail no encontrado' })
  async create(@GetVitalId() vitalId: string, @Body() dto: CreateScheduleDto) {
    return this.schedulesService.create(vitalId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un horario (soft-delete)' })
  @ApiResponse({ status: 200, description: 'Horario eliminado' })
  @ApiResponse({ status: 404, description: 'Horario no encontrado' })
  async remove(@GetVitalId() vitalId: string, @Param('id', ParseIntPipe) id: number) {
    return this.schedulesService.remove(vitalId, id);
  }
}

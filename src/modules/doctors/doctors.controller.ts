import { Controller, Get, UseGuards, Post, Param, ParseIntPipe, Query, Body, Delete, Put, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DoctorsService } from './doctors.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';
import type { Response } from 'express';

@ApiTags('Doctors (Médicos)')
@ApiBearerAuth()
@Controller('doctors')
@UseGuards(JwtAuthGuard)
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) { }

  @Get('dashboard')
  @ApiOperation({ summary: 'Obtener métricas y datos para el dashboard principal del médico' })
  async getDashboard(@GetVitalId() vitalId: string) {
    return this.doctorsService.getDashboardData(vitalId);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Listar solicitudes pendientes de pacientes' })
  async getRequests(@GetVitalId() vitalId: string) {
    return this.doctorsService.getPendingRequests(vitalId);
  }

  @Post('requests/:id/accept')
  @ApiOperation({ summary: 'Aceptar solicitud de vinculación de un paciente' })
  async acceptRequest(@GetVitalId() vitalId: string, @Param('id', ParseIntPipe) id: number) {
    return this.doctorsService.acceptRequest(vitalId, id);
  }

  @Post('requests/:id/reject')
  @ApiOperation({ summary: 'Rechazar solicitud de vinculación de un paciente' })
  async rejectRequest(@GetVitalId() vitalId: string, @Param('id', ParseIntPipe) id: number) {
    return this.doctorsService.rejectRequest(vitalId, id);
  }

  @Get('patients')
  @ApiOperation({ summary: 'Obtener listado de pacientes del médico y estadísticas' })
  async getPatients(@GetVitalId() vitalId: string, @Query('search') search?: string) {
    return this.doctorsService.getPatientsList(vitalId, search);
  }

  // ====================================================================
  // RUTAS DE TRATAMIENTOS
  // ====================================================================

  @Get('treatments')
  @ApiOperation({ summary: 'Obtener todos los tratamientos globales de los pacientes del médico' })
  async getGlobalTreatments(@GetVitalId() vitalId: string) {
    return this.doctorsService.getGlobalTreatments(vitalId);
  }

  @Get('patients/:patientId/treatments')
  @ApiOperation({ summary: 'Obtener el panel de tratamientos de un paciente en específico' })
  async getPatientTreatments(
    @GetVitalId() vitalId: string,
    @Param('patientId', ParseIntPipe) patientId: number
  ) {
    return this.doctorsService.getPatientTreatmentsDashboard(vitalId, patientId);
  }

  @Get('treatments/:treatmentId')
  @ApiOperation({ summary: 'Obtener los detalles y configuración de un tratamiento' })
  async getTreatmentDetails(
    @GetVitalId() vitalId: string,
    @Param('treatmentId', ParseIntPipe) treatmentId: number
  ) {
    return this.doctorsService.getTreatmentDetails(vitalId, treatmentId);
  }

  @Get('treatments/:treatmentId/history')
  @ApiOperation({ summary: 'Obtener el historial y logs de tomas de un tratamiento' })
  async getTreatmentHistory(
    @GetVitalId() vitalId: string,
    @Param('treatmentId', ParseIntPipe) treatmentId: number
  ) {
    return this.doctorsService.getTreatmentHistory(vitalId, treatmentId);
  }

  @Post('treatments/:treatmentId/medications')
  @ApiOperation({ summary: 'Agregar un medicamento a un tratamiento existente' })
  async addMedication(
    @GetVitalId() vitalId: string,
    @Param('treatmentId', ParseIntPipe) treatmentId: number,
    @Body() body: any
  ) {
    return this.doctorsService.addMedicationToTreatment(vitalId, treatmentId, body);
  }

  @Post('patients/:patientId/treatments')
  @ApiOperation({ summary: 'Crear un nuevo tratamiento vacío para un paciente' })
  async createTreatment(
    @GetVitalId() vitalId: string,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Body() body: any
  ) {
    return this.doctorsService.createTreatment(vitalId, patientId, body);
  }

  @Put('treatments/:treatmentId')
  @ApiOperation({ summary: 'Actualizar fechas de un tratamiento' })
  async updateTreatment(
    @GetVitalId() vitalId: string,
    @Param('treatmentId', ParseIntPipe) treatmentId: number,
    @Body() body: any
  ) {
    return this.doctorsService.updateTreatment(vitalId, treatmentId, body);
  }

  @Delete('treatments/medications/:detailId')
  @ApiOperation({ summary: 'Eliminar (soft delete) un medicamento de un tratamiento' })
  async removeMedication(
    @GetVitalId() vitalId: string,
    @Param('detailId', ParseIntPipe) detailId: number
  ) {
    return this.doctorsService.removeMedicationFromTreatment(vitalId, detailId);
  }

  @Get('reports')
  async getReportsData(@GetVitalId() vitalId: string) {
    return this.doctorsService.getReportsDashboard(vitalId);
  }

  @Get('reports/download')
  async downloadReport(
    @GetVitalId() vitalId: string,
    @Query('type') type: string,
    @Query('target') target: string,
    @Query('doctorName') doctorName: string,
    @Query('cedula') cedula: string,    
    @Res() res: Response
  ) {
    // Le pasamos los nuevos datos al servicio
    const pdfBuffer = await this.doctorsService.generatePdfReport(vitalId, type, target, doctorName, cedula);

    const filename = `Reporte_${type.replace(/\s+/g, '_')}_${Date.now()}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }
}
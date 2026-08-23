import { Controller, Get, UseGuards, Param, Res, Body, Post } from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @UseGuards(JwtAuthGuard)
    @Get('dashboard-stats')
    async getStats() {
        return await this.adminService.getDashboardStats();
    }

    @UseGuards(JwtAuthGuard)
    @Get('doctors')
    async getDoctors() {
        return await this.adminService.getDoctorsList();
    }

    @UseGuards(JwtAuthGuard)
    @Get('doctors/:id')
    async getDoctorProfile(@Param('id') id: string) {
        return await this.adminService.getDoctorProfile(Number(id));
    }

    @UseGuards(JwtAuthGuard)
    @Get('patients')
    async getPatients() {
        return await this.adminService.getPatientsList();
    }

    @UseGuards(JwtAuthGuard)
    @Get('patients/:id')
    async getPatientProfile(@Param('id') id: string) {
        return await this.adminService.getPatientProfile(Number(id));
    }

    @UseGuards(JwtAuthGuard)
    @Get('devices')
    async getDevices() {
        return await this.adminService.getDevicesList();
    }

    @UseGuards(JwtAuthGuard)
    @Get('devices/:uniqueCode')
    async getDeviceProfile(@Param('uniqueCode') uniqueCode: string) {
        return await this.adminService.getDeviceProfile(uniqueCode);
    }

    @UseGuards(JwtAuthGuard)
    @Get('incidents')
    async getIncidents() {
        return await this.adminService.getIncidentsList();
    }

    @UseGuards(JwtAuthGuard)
    @Get('incidents/:idRef')
    async getIncidentDetail(@Param('idRef') idRef: string) {
        return await this.adminService.getIncidentDetail(idRef);
    }

    @UseGuards(JwtAuthGuard)
    @Get('firmware/dashboard')
    async getFirmwareDashboard() {
        return await this.adminService.getFirmwareDashboard();
    }

    @UseGuards(JwtAuthGuard)
    @Get('logs')
    async getTechnicalLogs() {
        return await this.adminService.getTechnicalLogs();
    }

    @UseGuards(JwtAuthGuard)
    @Get('reports/dashboard')
    async getReportsDashboard() {
        return await this.adminService.getReportsDashboard();
    }

    @UseGuards(JwtAuthGuard)
    @Get('reports/export-pdf')
    async exportAdminPdf(@Res() res: Response) {
        const buffer = await this.adminService.generateGlobalPdfReport();
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="VitalGuard_Reporte_Operaciones.pdf"',
            'Content-Length': buffer.length,
        });
        res.end(buffer);
    }

    @UseGuards(JwtAuthGuard)
  @Get('admins')
  async getAdmins() {
    return await this.adminService.getAdminsList();
  }

  @UseGuards(JwtAuthGuard)
  @Post('admins')
  async createAdmin(@Body() body: any) {
    return await this.adminService.createAdmin(body);
  }
}
import { Controller, Get, UseGuards, Param, Res, Body, Post } from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('dashboard-stats')
    async getStats() {
        return await this.adminService.getDashboardStats();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('doctors')
    async getDoctors() {
        return await this.adminService.getDoctorsList();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('doctors/:id')
    async getDoctorProfile(@Param('id') id: string) {
        return await this.adminService.getDoctorProfile(Number(id));
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('patients')
    async getPatients() {
        return await this.adminService.getPatientsList();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('patients/:id')
    async getPatientProfile(@Param('id') id: string) {
        return await this.adminService.getPatientProfile(Number(id));
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('devices')
    async getDevices() {
        return await this.adminService.getDevicesList();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('devices/:uniqueCode')
    async getDeviceProfile(@Param('uniqueCode') uniqueCode: string) {
        return await this.adminService.getDeviceProfile(uniqueCode);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('incidents')
    async getIncidents() {
        return await this.adminService.getIncidentsList();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('incidents/:idRef')
    async getIncidentDetail(@Param('idRef') idRef: string) {
        return await this.adminService.getIncidentDetail(idRef);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('firmware/dashboard')
    async getFirmwareDashboard() {
        return await this.adminService.getFirmwareDashboard();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('logs')
    async getTechnicalLogs() {
        return await this.adminService.getTechnicalLogs();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('reports/dashboard')
    async getReportsDashboard() {
        return await this.adminService.getReportsDashboard();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
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

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
  @Get('admins')
  async getAdmins() {
    return await this.adminService.getAdminsList();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
  @Post('admins')
  async createAdmin(@Body() body: any) {
    return await this.adminService.createAdmin(body);
  }
}
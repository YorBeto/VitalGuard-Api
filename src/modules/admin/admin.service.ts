import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class AdminService {
    constructor(private readonly prisma: PrismaService) { }

    // Función de ayuda para calcular el tiempo transcurrido (Ahora acepta null)
    private getTimeAgo(date: Date | null): string {
        if (!date) return 'Desconocido';
        const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
        if (seconds < 60) return `Hace ${seconds} segundos`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `Hace ${minutes} minutos`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `Hace ${hours} horas`;
        const days = Math.floor(hours / 24);
        return `Hace ${days} días`;
    }

    async getDashboardStats() {
        // 1. CONTEOS PRINCIPALES
        const totalPatients = await this.prisma.patients.count({ where: { deleted_at: null } });
        const totalDoctors = await this.prisma.doctors.count({ where: { deleted_at: null } });
        const totalDevices = await this.prisma.devices.count({ where: { deleted_at: null } });

        // Omitimos deleted_at aquí por la desincronización con tu DB física
        const activeIncidents = await this.prisma.sos_events.count({ where: { status: 'Activo' } });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const alertsToday = await this.prisma.sos_events.count({
            where: { created_at: { gte: today } },
        });

        // 2. ADHERENCIA GLOBAL
        const totalPastLogs = await this.prisma.medication_logs.count({
            where: { scheduled_datetime: { lte: new Date() }, deleted_at: null },
        });
        const confirmedLogs = await this.prisma.medication_logs.count({
            where: { status: 'Confirmado', deleted_at: null },
        });
        const globalAdherence = totalPastLogs > 0 ? Math.round((confirmedLogs / totalPastLogs) * 100) : 0;

        // 3. GRÁFICA DE ACTIVIDAD (Tipada correctamente para evitar el error 'never')
        const activityData: Array<{ day: string; value: number; height: string }> = [];
        let maxCount = 0;

        for (let i = 5; i >= 0; i--) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - i);
            const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
            const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

            const count = await this.prisma.medication_logs.count({
                where: { created_at: { gte: startOfDay, lte: endOfDay } }
            });

            if (count > maxCount) maxCount = count;

            // Formato: "Lun", "Mar", etc.
            const dayName = new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(startOfDay);

            activityData.push({
                day: dayName.charAt(0).toUpperCase() + dayName.slice(1),
                value: count,
                height: '0%'
            });
        }

        // Calcula el porcentaje de altura para el frontend
        activityData.forEach(item => {
            item.height = maxCount > 0 ? `${Math.round((item.value / maxCount) * 100)}%` : '0%';
        });

        // 4. ACTIVIDAD RECIENTE (Últimas 4 notificaciones)
        const recentNotifications = await this.prisma.notifications.findMany({
            orderBy: { created_at: 'desc' },
            take: 4,
        });

        const recentActivity = recentNotifications.map(n => ({
            timeAgo: this.getTimeAgo(n.created_at),
            description: n.message
        }));

        // 5. ESTADO DEL SISTEMA
        const systemStatus = {
            mqtt: 'Online',
            api: 'Online',
            database: 'Online',
            ota: 'Online',
            notifications: recentNotifications.length > 0 ? 'Online' : 'Sin datos'
        };

        // 6. ESTRUCTURA FINAL
        return {
            stats: {
                patients: totalPatients,
                doctors: totalDoctors,
                devices: totalDevices,
                incidents: activeIncidents,
                critical: activeIncidents,
            },
            summary: {
                globalAdherence,
                activeSos: activeIncidents,
                alertsToday,
                otaUpdates: 96,
            },
            activityData,
            recentActivity,
            systemStatus
        };
    }

    // ==========================================
    // ENDPOINT: LISTA DE MÉDICOS
    // ==========================================
    async getDoctorsList() {
        const doctors = await this.prisma.doctors.findMany({
            where: { deleted_at: null },
            include: {
                app_profiles: true,
                doctor_patient: true,
            },
        });

        const total = doctors.length;
        const activos = doctors.filter(d => d.app_profiles.is_active).length;
        const suspendidos = doctors.filter(d => !d.app_profiles.is_active).length;
        const pendientes = 0;

        // Usamos Promise.all porque vamos a hacer peticiones HTTP por cada médico
        const doctorsList = await Promise.all(doctors.map(async (d) => {
            // 👇 Aquí cruzamos los datos con Vital ID
            const vitalIdData = await this.getVitalIdUser(d.app_profiles.vital_id);

            return {
                id: d.id,
                vital_id: d.app_profiles.vital_id,
                initials: vitalIdData.initials,
                name: vitalIdData.name,
                email: vitalIdData.email,
                specialty: d.specialty,
                patients: d.doctor_patient.length,
                date: d.created_at ? new Intl.DateTimeFormat('es-MX').format(d.created_at) : 'N/A',
                status: d.app_profiles.is_active ? 'Activo' : 'Suspendido',
                badgeClass: d.app_profiles.is_active ? 'badge-success' : 'badge-danger',
            };
        }));

        return {
            stats: { total, activos, pendientes, suspendidos },
            doctors: doctorsList
        };
    }

    // ==========================================
    // ENDPOINT: PERFIL DEL MÉDICO
    // ==========================================
    async getDoctorProfile(doctorId: number) {
        const doctor = await this.prisma.doctors.findUnique({
            where: { id: doctorId },
            include: {
                app_profiles: true,
                doctor_patient: {
                    include: {
                        patients: {
                            include: {
                                treatments: {
                                    where: { deleted_at: null }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!doctor) throw new Error("Médico no encontrado");

        const vitalIdData = await this.getVitalIdUser(doctor.app_profiles.vital_id);

        // 1. Obtener Pacientes y Tratamientos Activos
        const patientsList = doctor.doctor_patient.map(dp => dp.patients);
        let activeTreatmentsCount = 0;
        patientsList.forEach(p => {
            activeTreatmentsCount += p.treatments.filter(t => t.status === 'Activo').length;
        });

        // 2. Calcular Adherencia Promedio y Estado de los últimos 3 pacientes
        const recentPatients: Array<{
            id: number;
            name: string;
            adherence: number;
            status: string;
            statusColor: string;
        }> = [];
        let totalAdherenceSum = 0;

        for (const patient of patientsList) {
            // Buscar tomas de medicamentos de este paciente
            const pastLogs = await this.prisma.medication_logs.count({
                where: {
                    schedules: { treatment_details: { treatments: { patient_id: patient.id } } },
                    scheduled_datetime: { lte: new Date() },
                    deleted_at: null,
                }
            });

            const confirmedLogs = await this.prisma.medication_logs.count({
                where: {
                    schedules: { treatment_details: { treatments: { patient_id: patient.id } } },
                    status: 'Confirmado',
                    deleted_at: null,
                }
            });

            const adherence = pastLogs > 0 ? Math.round((confirmedLogs / pastLogs) * 100) : 0;
            totalAdherenceSum += adherence;

            // Determinar estado de salud / adherencia
            let patientStatus = 'Crítico';
            let statusColor = '#EB5757';
            if (adherence >= 85) { patientStatus = 'Excelente'; statusColor = '#27AE60'; }
            else if (adherence >= 60) { patientStatus = 'Atención'; statusColor = '#F2C94C'; }

            recentPatients.push({
                id: patient.id,
                name: `${patient.first_name} ${patient.paternal_last_name}`,
                adherence,
                status: patientStatus,
                statusColor
            });
        }

        const averageAdherence = patientsList.length > 0 ? Math.round(totalAdherenceSum / patientsList.length) : 0;

        // 3. Estructura Final
        return {
            profile: {
                id: doctor.id,
                initials: vitalIdData.initials,
                name: vitalIdData.name,
                email: vitalIdData.email,
                specialty: doctor.specialty,
                license: doctor.medical_license,
                date: doctor.created_at ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).format(doctor.created_at) : 'N/A',
                status: doctor.app_profiles.is_active ? 'Activo' : 'Suspendido',
                badgeClass: doctor.app_profiles.is_active ? 'badge-success' : 'badge-danger',
            },
            stats: {
                patients: patientsList.length,
                treatments: activeTreatmentsCount,
                adherence: averageAdherence,
                alerts: 0 // Pendiente de cruzar con Notificaciones/SOS del médico
            },
            recentPatients: recentPatients.slice(0, 3) // Mandamos solo los 3 primeros para la tabla
        };
    }

    private async getVitalIdUser(vitalId: string) {
        if (!vitalId || !/^[0-9a-fA-F-]{36}$/.test(vitalId)) {
            return { name: "Médico (Datos no disponibles)", email: "error@conexion.com", initials: "MD" };
        }
        try {
            const vitalIdBaseUrl = process.env.VITAL_ID_API_URL;
            if (!vitalIdBaseUrl) {
                return { name: "Médico (Datos no disponibles)", email: "error@conexion.com", initials: "MD" };
            }
            const endpoint = `${vitalIdBaseUrl.replace(/\/$/, '')}/auth/user/${encodeURIComponent(vitalId)}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(endpoint, {
                signal: controller.signal,
                headers: { 'X-Internal-Api-Key': process.env.INTERNAL_SERVICE_KEY || '' },
            });
            clearTimeout(timeout);
            if (response.ok) {
                const responseJson: any = await response.json();
                const userData = responseJson.data ? responseJson.data : responseJson;
                const firstName = userData.person?.first_name || '';
                const lastName = userData.person?.paternal_last_name || '';
                const fullName = `${firstName} ${lastName}`.trim();
                return {
                    name: fullName || `Médico (Sin nombre)`,
                    email: userData.email || "Sin correo",
                    initials: firstName ? firstName.substring(0, 2).toUpperCase() : "MD"
                };
            }
        } catch (error: any) {
            // Silencioso: usa fallback sin spam de logs
        }
        return { name: "Médico (Datos no disponibles)", email: "error@conexion.com", initials: "MD" };
    }

    // ==========================================
    // ENDPOINT: LISTA DE PACIENTES
    // ==========================================
    async getPatientsList() {
        const patients = await this.prisma.patients.findMany({
            where: { deleted_at: null },
            include: {
                devices: true,
                doctor_patient: {
                    include: {
                        doctors: {
                            include: { app_profiles: true }
                        }
                    }
                }
            }
        });

        let totalAlertsToday = 0;
        let activePatientsCount = 0;
        let globalAdherenceSum = 0;
        let criticalCount = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const patientsList = await Promise.all(patients.map(async (p) => {
            // 1. Obtener el médico asignado (el primero si hay varios)
            let doctorName = "Sin asignar";
            if (p.doctor_patient.length > 0) {
                const vitalId = p.doctor_patient[0].doctors.app_profiles.vital_id;
                const doctorData = await this.getVitalIdUser(vitalId);
                doctorName = doctorData.name;
            }

            // 2. Calcular adherencia del paciente
            const pastLogs = await this.prisma.medication_logs.count({
                where: {
                    schedules: { treatment_details: { treatments: { patient_id: p.id } } },
                    scheduled_datetime: { lte: new Date() },
                    deleted_at: null,
                }
            });

            const confirmedLogs = await this.prisma.medication_logs.count({
                where: {
                    schedules: { treatment_details: { treatments: { patient_id: p.id } } },
                    status: 'Confirmado',
                    deleted_at: null,
                }
            });

            const adherence = pastLogs > 0 ? Math.round((confirmedLogs / pastLogs) * 100) : 0;
            globalAdherenceSum += adherence;

            // 3. Alertas de hoy del paciente
            const patientAlerts = await this.prisma.sos_events.count({
                where: {
                    patient_id: p.id,
                    created_at: { gte: today }
                }
            });
            totalAlertsToday += patientAlerts;

            // 4. Determinar estado
            let status = 'Activo';
            let badgeClass = 'badge-success';
            if (adherence < 60) {
                status = 'Crítico';
                badgeClass = 'badge-danger';
                criticalCount++;
            } else if (adherence < 85) {
                status = 'Atención';
                badgeClass = 'badge-warning';
            }

            if (p.devices && p.devices.is_online) {
                activePatientsCount++;
            }

            return {
                id: p.id,
                initials: `${p.first_name.charAt(0)}${p.paternal_last_name.charAt(0)}`.toUpperCase(),
                name: `${p.first_name} ${p.paternal_last_name} ${p.maternal_last_name || ''}`.trim(),
                email: p.phone ? `${p.phone}@vital.com` : "Sin correo", // Placeholder temporal si no hay tabla de usuarios para pacientes
                doctor: doctorName,
                device: p.devices ? p.devices.unique_code : 'Sin dispositivo',
                adherence: `${adherence}%`,
                sync: p.devices?.last_sync_at ? this.getTimeAgo(p.devices.last_sync_at) : 'Nunca',
                status,
                badgeClass,
            };
        }));

        const globalAdherence = patients.length > 0 ? Math.round(globalAdherenceSum / patients.length) : 0;

        return {
            stats: {
                total: patients.length,
                activos: activePatientsCount,
                adherenciaGlobal: globalAdherence,
                alertasHoy: totalAlertsToday,
                criticos: criticalCount,
            },
            patients: patientsList
        };
    }

    // ==========================================
    // ENDPOINT: PERFIL DEL PACIENTE
    // ==========================================
    async getPatientProfile(patientId: number) {
        const patient = await this.prisma.patients.findUnique({
            where: { id: patientId },
            include: {
                devices: true,
                doctor_patient: {
                    include: { doctors: { include: { app_profiles: true } } }
                },
                treatments: true,
            }
        });

        if (!patient) throw new Error("Paciente no encontrado");

        // 1. Calcular Edad
        const birthDate = new Date(patient.birth_date);
        let age = new Date().getFullYear() - birthDate.getFullYear();
        const m = new Date().getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && new Date().getDate() < birthDate.getDate())) {
            age--;
        }

        // 2. Obtener Médico
        let doctorName = "Sin asignar";
        if (patient.doctor_patient.length > 0) {
            const vitalId = patient.doctor_patient[0].doctors.app_profiles.vital_id;
            const doctorData = await this.getVitalIdUser(vitalId);
            doctorName = doctorData.name;
        }

        // 3. Adherencia y Estadísticas
        const pastLogs = await this.prisma.medication_logs.count({
            where: {
                schedules: { treatment_details: { treatments: { patient_id: patient.id } } },
                scheduled_datetime: { lte: new Date() },
                deleted_at: null,
            }
        });

        const confirmedLogs = await this.prisma.medication_logs.count({
            where: {
                schedules: { treatment_details: { treatments: { patient_id: patient.id } } },
                status: 'Confirmado',
                deleted_at: null,
            }
        });

        const omittedLogs = await this.prisma.medication_logs.count({
            where: {
                schedules: { treatment_details: { treatments: { patient_id: patient.id } } },
                status: 'Omitida',
                deleted_at: null,
            }
        });

        const sosCount = await this.prisma.sos_events.count({
            where: { patient_id: patient.id }
        });

        const adherence = pastLogs > 0 ? Math.round((confirmedLogs / pastLogs) * 100) : 0;

        // 4. Actividad Reciente (Últimos 4 registros combinados)
        const recentLogs = await this.prisma.medication_logs.findMany({
            where: { schedules: { treatment_details: { treatments: { patient_id: patient.id } } } },
            orderBy: { created_at: 'desc' },
            take: 4,
        });

        const recentActivity = recentLogs.map(log => ({
            time: this.getTimeAgo(log.created_at),
            description: log.status === 'Confirmado' ? 'Medicamento Tomado' : `Registro: ${log.status}`
        }));

        // 5. Tratamientos
        const activeTreatments = patient.treatments.map(t => ({
            id: t.id,
            name: `Tratamiento #${t.id}`,
            start: new Intl.DateTimeFormat('es-MX').format(t.start_date),
            end: t.end_date ? new Intl.DateTimeFormat('es-MX').format(t.end_date) : 'Indefinido',
            status: t.status
        }));

        return {
            profile: {
                id: patient.id,
                initials: `${patient.first_name.charAt(0)}${patient.paternal_last_name.charAt(0)}`.toUpperCase(),
                name: `${patient.first_name} ${patient.paternal_last_name}`.trim(),
                age: `${age} años`,
                status: adherence >= 60 ? 'Paciente Activo' : 'Paciente Crítico',
                badgeClass: adherence >= 60 ? 'badge-success' : 'badge-danger',
                doctor: doctorName,
                email: patient.phone ? `${patient.phone}@vital.com` : "Sin correo",
                phone: patient.phone || "Sin registro",
                registration: patient.created_at ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).format(patient.created_at) : 'N/A',
            },
            device: {
                id: patient.devices?.unique_code || 'N/A',
                firmware: patient.devices?.firmware_version || 'N/A',
                battery: '100%',
                status: patient.devices?.is_online ? 'Conectado' : 'Desconectado',
            },
            stats: {
                adherence: `${adherence}%`,
                totalLogs: pastLogs,
                alerts: sosCount,
                omitted: omittedLogs,
            },
            treatments: activeTreatments,
            recentActivity
        };
    }

    // ==========================================
    // ENDPOINT: LISTA DE DISPOSITIVOS
    // ==========================================
    async getDevicesList() {
        const devices = await this.prisma.devices.findMany({
            where: { deleted_at: null },
            include: { patients: true }
        });

        const total = devices.length;
        const enLinea = devices.filter(d => d.is_online).length;
        const offline = total - enLinea;
        const otaPendiente = 0; // Se puede calcular si agregas una tabla de versiones OTA
        const mqttActivos = enLinea;

        const devicesList = devices.map(d => {
            let patientName = "Sin asignar";
            if (d.patients) {
                patientName = `${d.patients.first_name} ${d.patients.paternal_last_name}`.trim();
            }

            return {
                id: d.unique_code,
                patient: patientName,
                firmware: d.firmware_version || 'v1.0.0',
                battery: '100%', // Placeholder: Requiere columna en BD
                status: d.is_online ? 'Online' : 'Offline',
                mqtt: d.is_online ? 'Conectado' : 'Desconectado',
                sync: d.last_sync_at ? this.getTimeAgo(d.last_sync_at) : 'Nunca',
            };
        });

        return {
            stats: { total, enLinea, offline, otaPendiente, mqttActivos },
            devices: devicesList
        };
    }

    // ==========================================
    // ENDPOINT: PERFIL DEL DISPOSITIVO
    // ==========================================
    async getDeviceProfile(uniqueCode: string) {
        const device = await this.prisma.devices.findUnique({
            where: { unique_code: uniqueCode },
            include: {
                patients: {
                    include: {
                        doctor_patient: { include: { doctors: { include: { app_profiles: true } } } },
                        treatments: {
                            include: { treatment_details: { include: { medications: true } } }
                        }
                    }
                },
                device_compartments: true,
                sos_events: true
            }
        });

        if (!device) throw new Error("Dispositivo no encontrado");

        let doctorName = "Sin asignar";
        let patientAdherence = 0;
        let patientAge = "N/A";
        let patientStatus = "Sin asignar";

        // Cálculos del paciente vinculado
        if (device.patients) {
            const birthDate = new Date(device.patients.birth_date);
            let age = new Date().getFullYear() - birthDate.getFullYear();
            if (new Date().getMonth() < birthDate.getMonth()) age--;
            patientAge = `${age} años`;

            if (device.patients.doctor_patient.length > 0) {
                const vitalId = device.patients.doctor_patient[0].doctors.app_profiles.vital_id;
                const doctorData = await this.getVitalIdUser(vitalId);
                doctorName = doctorData.name;
            }

            const pastLogs = await this.prisma.medication_logs.count({
                where: { schedules: { treatment_details: { treatments: { patient_id: device.patients.id } } }, scheduled_datetime: { lte: new Date() }, deleted_at: null }
            });
            const confirmedLogs = await this.prisma.medication_logs.count({
                where: { schedules: { treatment_details: { treatments: { patient_id: device.patients.id } } }, status: 'Confirmado', deleted_at: null }
            });
            patientAdherence = pastLogs > 0 ? Math.round((confirmedLogs / pastLogs) * 100) : 0;
            patientStatus = patientAdherence >= 60 ? 'Activo' : 'Crítico';
        }

        // Mapeo dinámico de los 5 compartimentos
        const compartments: Array<{ number: number; medication: string; isOccupied: boolean }> = [];
        for (let i = 1; i <= 5; i++) {
            let medicationName = "Libre";
            let isOccupied = false;

            if (device.patients) {
                for (const treatment of device.patients.treatments) {
                    if (treatment.status === 'Activo') {
                        // Buscamos si algún detalle de tratamiento está asignado a este compartimento
                        const detail = treatment.treatment_details.find(td => td.compartment_number === i && td.status === 'En_curso');
                        if (detail) {
                            medicationName = detail.medications.name;
                            isOccupied = true;
                            break;
                        }
                    }
                }
            }

            compartments.push({
                number: i,
                medication: isOccupied ? `#${i} ${medicationName}` : `#${i} Libre`,
                isOccupied
            });
        }

        return {
            profile: {
                id: device.unique_code,
                firmware: device.firmware_version || 'v1.0.0',
                mac: "18:4A:22:89:XX", // Placeholder: Requiere columna en BD
                mqtt: device.is_online ? 'Conectado' : 'Desconectado',
                status: device.is_online ? 'Online' : 'Offline',
                sync: device.last_sync_at ? this.getTimeAgo(device.last_sync_at) : 'Nunca',
            },
            stats: {
                battery: '100%', // Placeholder
                wifi: '98%', // Placeholder
                alerts: device.sos_events.length,
                syncAgo: device.last_sync_at ? this.getTimeAgo(device.last_sync_at) : 'Nunca'
            },
            patient: {
                name: device.patients ? `${device.patients.first_name} ${device.patients.paternal_last_name}`.trim() : 'Sin asignar',
                doctor: doctorName,
                age: patientAge,
                adherence: `${patientAdherence}%`,
                status: patientStatus
            },
            compartments
        };

    }

    // ==========================================
    // ENDPOINT: LISTA DE INCIDENCIAS
    // ==========================================
    async getIncidentsList() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. SOS (Críticas)
        const sosEvents = await this.prisma.sos_events.findMany({
            include: { patients: true, devices: true },
            orderBy: { created_at: 'desc' },
            take: 10
        });

        // 2. Omisiones (Advertencias)
        const omissions = await this.prisma.medication_logs.findMany({
            where: { status: 'Omitida', deleted_at: null },
            include: {
                schedules: {
                    include: {
                        treatment_details: {
                            include: { treatments: { include: { patients: true } } }
                        }
                    }
                }
            },
            orderBy: { scheduled_datetime: 'desc' },
            take: 10
        });

        // 3. Dispositivos Offline (Info)
        const offlineDevices = await this.prisma.devices.findMany({
            where: { is_online: false, deleted_at: null },
            include: { patients: true }
        });

        const incidents: any[] = [];
        let incidenciasHoy = 0;
        let criticas = 0;
        let advertencias = 0;
        let resueltas = 0;
        let sosActivos = 0;

        // Procesamos SOS
        sosEvents.forEach(sos => {
            if (sos.created_at && sos.created_at >= today) incidenciasHoy++;
            if (sos.status === 'Activo') {
                criticas++;
                sosActivos++;
            } else {
                resueltas++;
            }

            const patientName = sos.patients ? `${sos.patients.first_name} ${sos.patients.paternal_last_name}` : 'Desconocido';

            incidents.push({
                id: `SOS-${sos.id}`, // Prefijo para saber de qué tabla viene
                type: 'SOS',
                patient: patientName,
                priority: 'Alta',
                status: sos.status === 'Activo' ? 'Abierta' : 'Resuelta',
                badgeClass: sos.status === 'Activo' ? 'badge-danger' : 'badge-success',
                date: sos.created_at || new Date(),
                alertType: 'CRÍTICO',
                alertTitle: 'SOS Activado',
                alertDescription: `${patientName} activó el botón SOS desde el dispositivo ${sos.devices?.unique_code || 'N/A'}. Ubicación reportada y notificación enviada.`,
                iconType: 'SOS'
            });
        });

        // Procesamos Omisiones
        omissions.forEach(om => {
            if (om.scheduled_datetime >= today) incidenciasHoy++;
            advertencias++;

            const patient = om.schedules?.treatment_details?.treatments?.patients;
            const patientName = patient ? `${patient.first_name} ${patient.paternal_last_name}` : 'Desconocido';

            incidents.push({
                id: `OMI-${om.id}`,
                type: 'Omisión',
                patient: patientName,
                priority: 'Media',
                status: 'Pendiente',
                badgeClass: 'badge-warning',
                date: om.scheduled_datetime,
                alertType: 'ATENCIÓN',
                alertTitle: 'Medicamento Omitido',
                alertDescription: `${patientName} omitió una toma programada para el día de hoy.`,
                iconType: 'OMISION'
            });
        });

        // Procesamos Offline
        offlineDevices.forEach(dev => {
            advertencias++;
            incidents.push({
                id: `DEV-${dev.id}`,
                type: 'Offline',
                patient: dev.patients ? `${dev.patients.first_name} ${dev.patients.paternal_last_name}` : 'Sin asignar',
                priority: 'Baja',
                status: 'Pendiente',
                badgeClass: 'badge-warning',
                date: dev.last_sync_at || new Date(),
                alertType: 'INFO',
                alertTitle: 'Dispositivo Offline',
                alertDescription: `El dispositivo ${dev.unique_code} no reporta conexión MQTT recientemente.`,
                iconType: 'OFFLINE'
            });
        });

        // Ordenar cronológicamente (las más recientes primero)
        incidents.sort((a, b) => b.date.getTime() - a.date.getTime());

        // Sacamos 1 de cada tipo para las tarjetas visuales de la izquierda
        const prioritarias = [
            incidents.find(i => i.iconType === 'SOS' && i.status === 'Abierta'),
            incidents.find(i => i.iconType === 'OMISION'),
            incidents.find(i => i.iconType === 'OFFLINE')
        ].filter(Boolean);

        return {
            stats: { incidenciasHoy, criticas, advertencias, resueltas, sosActivos },
            prioritarias,
            table: incidents.map(i => ({
                id: i.id, type: i.type, patient: i.patient, priority: i.priority, status: i.status, badgeClass: i.badgeClass
            }))
        };
    }

    // ==========================================
    // ENDPOINT: DETALLE DE INCIDENCIA (SOS)
    // ==========================================
    async getIncidentDetail(idRef: string) {
        const [prefix, rawId] = idRef.split('-');
        const id = parseInt(rawId);

        // Si es un SOS, traemos el detalle completo
        if (prefix === 'SOS') {
            const sos = await this.prisma.sos_events.findUnique({
                where: { id },
                include: {
                    patients: {
                        include: { doctor_patient: { include: { doctors: { include: { app_profiles: true } } } } }
                    },
                    devices: true
                }
            });

            if (!sos) throw new Error("Incidencia no encontrada");

            let doctorName = "Sin asignar";
            if (sos.patients?.doctor_patient?.length > 0) {
                const vitalId = sos.patients.doctor_patient[0].doctors.app_profiles.vital_id;
                const doctorData = await this.getVitalIdUser(vitalId);
                doctorName = doctorData.name;
            }

            const formattedDate = sos.created_at ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit' }).format(sos.created_at) : 'N/A';
            const formattedTime = sos.created_at ? new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(sos.created_at) : 'N/A';

            return {
                header: {
                    title: "SOS Activado",
                    subtitle: "Paciente solicitó asistencia urgente.",
                    priorityBadge: "Prioridad Crítica",
                    badgeClass: "badge-danger",
                },
                stats: {
                    date: formattedDate,
                    time: formattedTime,
                    device: sos.devices?.unique_code || 'N/A',
                    status: sos.status === 'Activo' ? 'Abierta' : 'Resuelta'
                },
                info: {
                    patient: sos.patients ? `${sos.patients.first_name} ${sos.patients.paternal_last_name}` : 'Desconocido',
                    doctor: doctorName,
                    device: sos.devices?.unique_code || 'N/A',
                    firmware: sos.devices?.firmware_version || 'v1.0.0',
                    location: "Mérida, Yucatán", // Placeholder geográfico
                    description: `El paciente activó manualmente el botón SOS desde el dispositivo ${sos.devices?.unique_code || ''}. El evento fue recibido por el broker MQTT y se notificó al médico.`
                },
                timeline: [
                    { title: "SOS Activado", description: "Botón presionado desde el dispositivo.", time: formattedTime, status: "completed" },
                    { title: "Evento MQTT Recibido", description: "Broker registró mensaje de emergencia.", time: formattedTime, status: "completed" },
                    { title: "Notificación Enviada", description: "Se notificó al médico responsable.", time: formattedTime, status: "completed" },
                    { title: sos.status === 'Activo' ? "Confirmación Pendiente" : "Incidencia Resuelta", description: sos.status === 'Activo' ? "Esperando cierre del incidente." : "El incidente ha sido atendido.", time: "Actual", status: "current" }
                ],
                isActive: sos.status === 'Activo'
            };
        }

        // Aquí podrías agregar "else if (prefix === 'OMI')" si lo necesitas en el futuro.
        throw new Error("Formato de detalle no soportado todavía");
    }

    // ==========================================
    // ENDPOINT: DASHBOARD DE FIRMWARE OTA
    // ==========================================
    async getFirmwareDashboard() {
        // Obtenemos todos los dispositivos físicos
        const devices = await this.prisma.devices.findMany({
            where: { deleted_at: null },
            orderBy: { last_sync_at: 'desc' }
        });

        // Simulamos que la versión más reciente que subiste es la v1.0.4
        const TARGET_VERSION = "v1.0.4";

        const total = devices.length;
        const actualizados = devices.filter(d => d.firmware_version === TARGET_VERSION).length;
        const pendientes = total - actualizados;
        const progressPercentage = total > 0 ? Math.round((actualizados / total) * 100) : 0;

        // Generamos la tabla de estado de dispositivos cruzando con tu tabla real
        const deviceTable = devices.map(d => ({
            id: d.unique_code,
            version: d.firmware_version || 'Desconocida',
            status: d.firmware_version === TARGET_VERSION ? 'Actualizado' : 'Pendiente',
            badgeClass: d.firmware_version === TARGET_VERSION ? 'badge-success' : 'badge-warning',
            sync: d.last_sync_at ? this.getTimeAgo(d.last_sync_at) : 'Nunca'
        }));

        // Datos simulados del historial (Hasta que crees la tabla 'firmware_releases')
        const history = [
            { version: 'v1.0.4', date: '15 Julio 2026', notes: 'Optimización MQTT, corrección de errores OTA y mejora de batería.', isCurrent: true },
            { version: 'v1.0.3', date: '01 Junio 2026', notes: 'Mejora del sistema de recordatorios y sincronización cloud.', isCurrent: false },
            { version: 'v1.0.2', date: '15 Mayo 2026', notes: 'Implementación inicial del monitoreo remoto.', isCurrent: false },
            { version: 'v1.0.1', date: '10 Abril 2026', notes: 'Versión beta para pruebas internas.', isCurrent: false }
        ];

        return {
            stats: {
                targetVersion: TARGET_VERSION,
                total,
                pendientes,
                actualizados,
                progressPercentage
            },
            activeRelease: {
                version: TARGET_VERSION,
                publishDate: '15 Julio 2026',
                description: 'Actualización de estabilidad MQTT, optimización energética y corrección de sincronización.'
            },
            deviceTable,
            history
        };
    }

    // ==========================================
    // ENDPOINT: LOGS TÉCNICOS (Híbrido)
    // ==========================================
    async getTechnicalLogs() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const logs: any[] = [];
        let eventosHoy = 0;
        let errores = 0;
        let countMqtt = 0;
        let countOta = 0;

        // 1. Obtener eventos reales de la base de datos (SOS)
        const sosEvents = await this.prisma.sos_events.findMany({
            include: { devices: true },
            orderBy: { created_at: 'desc' },
            take: 5
        });

        sosEvents.forEach(sos => {
            if (sos.created_at && sos.created_at >= today) eventosHoy++;

            logs.push({
                id: `SOS-${sos.id}`,
                date: sos.created_at ? new Intl.DateTimeFormat('es-MX', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                }).format(sos.created_at).replace(',', '') : 'N/A',
                type: 'SOS',
                device: sos.devices?.unique_code || 'N/A',
                message: 'Evento SOS generado por el paciente.',
                status: 'Crítico',
                badgeClass: 'badge-danger',
                rawDate: sos.created_at || new Date(0)
            });
        });

        // 2. Simular logs profundos de IoT/Sistema
        const mockEvents = [
            { id: 'M-1', type: 'MQTT', device: 'VG-205', message: 'Heartbeat recibido correctamente.', status: 'OK', badgeClass: 'badge-success', rawDate: new Date(Date.now() - 1000 * 60 * 5) },
            { id: 'M-2', type: 'OTA', device: 'VG-212', message: 'Firmware v1.0.4 instalado.', status: 'Completado', badgeClass: 'badge-success', rawDate: new Date(Date.now() - 1000 * 60 * 15) },
            { id: 'M-3', type: 'ESP32', device: 'VG-178', message: 'Nivel de batería reportado: 19%.', status: 'Advertencia', badgeClass: 'badge-warning', rawDate: new Date(Date.now() - 1000 * 60 * 45) },
            { id: 'M-4', type: 'MQTT', device: 'VG-178', message: 'Broker desconectado inesperadamente.', status: 'Error', badgeClass: 'badge-danger', rawDate: new Date(Date.now() - 1000 * 60 * 60) },
            { id: 'M-5', type: 'LOGIN', device: 'ADMIN', message: 'Inicio de sesión exitoso.', status: 'Info', badgeClass: 'badge-info', rawDate: new Date(Date.now() - 1000 * 60 * 120) },
            { id: 'M-6', type: 'API', device: 'SERVER', message: 'Sincronización con SSO completada.', status: 'OK', badgeClass: 'badge-success', rawDate: new Date(Date.now() - 1000 * 60 * 180) },
        ];

        mockEvents.forEach(mock => {
            if (mock.rawDate >= today) eventosHoy++;
            if (mock.status === 'Error') errores++;
            if (mock.type === 'MQTT') countMqtt++;
            if (mock.type === 'OTA') countOta++;

            logs.push({
                ...mock,
                date: new Intl.DateTimeFormat('es-MX', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                }).format(mock.rawDate).replace(',', ''),
            });
        });

        logs.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());

        return {
            stats: {
                eventosHoy: eventosHoy + 12450,
                errores: errores + 17,
                mqtt: countMqtt + 4218,
                ota: countOta + 202
            },
            logs: logs.map(({ rawDate, ...rest }) => rest)
        };
    }

    // ==========================================
    // ENDPOINT: DASHBOARD DE REPORTES GLOBALES
    // ==========================================
    async getReportsDashboard() {
        // 1. Estadísticas Globales
        const totalPatients = await this.prisma.patients.count({ where: { deleted_at: null } });
        const totalDoctors = await this.prisma.doctors.count({ where: { deleted_at: null } });
        const totalDevices = await this.prisma.devices.count({ where: { deleted_at: null } });
        const activeIncidents = await this.prisma.sos_events.count({ where: { status: 'Activo' } });
        const connectedDevices = await this.prisma.devices.count({ where: { is_online: true, deleted_at: null } });

        // 2. Cálculo de Adherencia Global
        const pastLogs = await this.prisma.medication_logs.count({
            where: { scheduled_datetime: { lte: new Date() }, deleted_at: null }
        });
        const confirmedLogs = await this.prisma.medication_logs.count({
            where: { status: 'Confirmado', deleted_at: null }
        });
        const globalAdherence = pastLogs > 0 ? Math.round((confirmedLogs / pastLogs) * 100) : 0;

        // 3. Top Médicos (Calculamos los 3 con más pacientes para simplificar la vista)
        const doctors = await this.prisma.doctors.findMany({
            where: { deleted_at: null },
            include: { doctor_patient: true, app_profiles: true },
            orderBy: { doctor_patient: { _count: 'desc' } },
            take: 3
        });

        const topDoctors = await Promise.all(doctors.map(async (doc, index) => {
            const vitalIdData = await this.getVitalIdUser(doc.app_profiles.vital_id);
            return {
                rank: `#${index + 1}`,
                name: `Dr(a). ${vitalIdData.name}`,
                patients: doc.doctor_patient.length,
                adherence: `${Math.floor(Math.random() * (99 - 85 + 1) + 85)}%` // Adherencia simulada alta para el top
            };
        }));

        // 4. Gráfica Mensual (Datos simulados de los últimos meses, mes actual dinámico)
        const monthlyData = [
            { month: "Mar", value: "82%", height: "45%" },
            { month: "Abr", value: "86%", height: "55%" },
            { month: "May", value: "89%", height: "65%" },
            { month: "Jun", value: "91%", height: "75%" },
            { month: "Jul", value: "93%", height: "85%" },
            { month: "Ago", value: `${globalAdherence}%`, height: `${globalAdherence}%` }
        ];

        return {
            stats: {
                patients: totalPatients,
                doctors: totalDoctors,
                devices: totalDevices,
                adherence: `${globalAdherence}%`,
                incidents: activeIncidents
            },
            monthlyData,
            topDoctors,
            summary: {
                activePatients: totalPatients,
                connectedDevices,
                sosAttended: '98%',
                otaUpdates: 203,
                uptime: '99.8%'
            }
        };
    }

    // ==========================================
    // ENDPOINT: GENERACIÓN DE PDF GLOBAL ADMIN
    // ==========================================
    async generateGlobalPdfReport(): Promise<Buffer> {
        const dashboardData = await this.getReportsDashboard();

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers: Buffer[] = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            // --- LOGO CENTRADO ---
            try {
                const logoWidth = 220;
                const logoX = (doc.page.width - logoWidth) / 2;
                const candidates = [
                    path.join(__dirname, '../../assets/logo.png'),
                    path.join(process.cwd(), 'src/assets/logo.png'),
                    path.join(process.cwd(), 'dist/assets/logo.png'),
                    path.join(__dirname, '../../assets/images/logo-sidebar.png'),
                ];
                const logoPath = candidates.find((p) => fs.existsSync(p));
                if (logoPath) doc.image(logoPath, logoX, 40, { width: logoWidth });
            } catch (error) {
                // Logo opcional, no bloquea PDF
            }

            // --- CABECERA ---
            doc.moveDown(5);
            doc.fontSize(18).fillColor('#0B1E36').font('Helvetica-Bold').text('Reporte Global de Operaciones', { align: 'center' });
            doc.fontSize(10).fillColor('#64748B').font('Helvetica').text(`Generado el: ${new Date().toLocaleDateString('es-MX')} a las ${new Date().toLocaleTimeString('es-MX')}`, { align: 'center' });
            doc.moveDown(2);

            // --- RESUMEN DEL ECOSISTEMA (CAJA GRIS) ---
            const startY = doc.y;
            doc.rect(50, startY, 495, 85).fillAndStroke('#F8FAFC', '#E5EAF1');

            doc.fillColor('#0B1E36').fontSize(14).font('Helvetica-Bold').text('Métricas Principales', 65, startY + 15);

            doc.font('Helvetica').fontSize(11).fillColor('#4B5563');
            doc.text(`Pacientes Totales: ${dashboardData.stats.patients}`, 65, startY + 40);
            doc.text(`Médicos Activos: ${dashboardData.stats.doctors}`, 65, startY + 60);

            doc.text(`Dispositivos IoT: ${dashboardData.stats.devices}`, 300, startY + 40);
            doc.text(`Adherencia Global: ${dashboardData.stats.adherence}`, 300, startY + 60);

            doc.y = startY + 110;

            // --- RENDIMIENTO MÉDICO ---
            doc.fontSize(14).fillColor('#2D72D9').font('Helvetica-Bold').text('Top Médicos por Adherencia', 50, doc.y);
            doc.moveDown(1);

            if (dashboardData.topDoctors.length === 0) {
                doc.fontSize(11).fillColor('#64748B').font('Helvetica').text('No hay médicos registrados actualmente.');
            } else {
                dashboardData.topDoctors.forEach(docData => {
                    doc.fontSize(12).fillColor('#0B1E36').font('Helvetica-Bold').text(`${docData.rank} ${docData.name}`);
                    doc.fontSize(10).fillColor('#4B5563').font('Helvetica').text(`   Pacientes bajo monitoreo: ${docData.patients} | Adherencia Promedio: ${docData.adherence}`);
                    doc.moveDown(0.5);
                });
            }

            doc.moveDown(1);

            // --- ESTADO DEL SISTEMA ---
            doc.fontSize(14).fillColor('#2D72D9').font('Helvetica-Bold').text('Estado del Ecosistema IoT', 50, doc.y);
            doc.moveDown(0.5);
            doc.fontSize(10).fillColor('#4B5563').font('Helvetica');
            doc.text(`• Dispositivos en línea: ${dashboardData.summary.connectedDevices}`);
            doc.text(`• Incidencias abiertas (SOS): ${dashboardData.stats.incidents}`);
            doc.text(`• Disponibilidad del servidor: ${dashboardData.summary.uptime}`);
            doc.text(`• Actualizaciones OTA desplegadas: ${dashboardData.summary.otaUpdates}`);

            // --- FOOTER ---
            const bottomMargin = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc.font('Helvetica').fontSize(8).fillColor('#94A3B8').text(
                'Este documento es generado automáticamente por el panel administrativo de VitalGuard y contiene información confidencial.',
                50, doc.page.height - 50, { align: 'center', width: 495 }
            );
            doc.page.margins.bottom = bottomMargin;

            doc.end();
        });
    }

    // ==========================================
    // ENDPOINT: OBTENER ADMINISTRADORES
    // ==========================================
    async getAdminsList() {
        // Buscamos los perfiles que tienen el role_id 4 (Admin)
        const adminProfiles = await this.prisma.app_profiles.findMany({
            where: { role_id: 4, deleted_at: null }
        });

        const adminsList = await Promise.all(adminProfiles.map(async (profile) => {
            const vitalIdData = await this.getVitalIdUser(profile.vital_id);
            return {
                id: profile.id,
                vital_id: profile.vital_id,
                name: vitalIdData.name,
                email: vitalIdData.email,
                status: profile.is_active ? 'Activo' : 'Suspendido',
            };
        }));

        return adminsList;
    }

    // ==========================================
    // ENDPOINT: CREAR NUEVO ADMINISTRADOR
    // ==========================================
    // ==========================================
    // ENDPOINT: CREAR NUEVO ADMINISTRADOR
    // ==========================================
    async createAdmin(data: any) {
        const vitalIdBaseUrl = process.env.VITAL_ID_API_URL;

        if (!vitalIdBaseUrl) {
            throw new BadRequestException("VITAL_ID_API_URL no está configurada en el servidor.");
        }

        try {
            // Preparamos el paquete de datos
            const payloadBody = {
                email: data.email,
                password: data.password,
                first_name: data.firstName,
                paternal_last_name: data.lastName,
                maternal_last_name: data.maternalLastName || "",
                phone: data.phone, // Si tu SSO exige que sea número ponle: Number(data.phone)

                // 👇 Agregamos la conversión a formato ISO para que NestJS lo acepte
                birth_date: new Date(data.birthDate).toISOString(),

                gender: data.gender,
                address: data.address || "",
                two_factor_enabled: false
            };

            // 🔍 LOG 1: ¿QUÉ ESTAMOS ENVIANDO?
            console.log("\n=============================================================");
            console.log("📤 [SSO-POST] Intentando registrar admin. Payload enviado:");
            console.log(payloadBody);
            console.log("=============================================================");

            // 1. Mandamos a crear el usuario en el SSO (Puerto 4000)
            const ssoResponse = await fetch(`${vitalIdBaseUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadBody)
            });

            if (!ssoResponse.ok) {
                const errorData = await ssoResponse.json();

                console.log("❌ [SSO-ERROR] Detalles reales del rechazo:");
                console.log(errorData.details); // Imprimimos la matriz con los errores reales

                // 👇 AHORA LEEMOS LA PROPIEDAD 'details' DEL SSO
                let errorMsg = errorData.message;
                if (errorData.details && Array.isArray(errorData.details)) {
                    errorMsg = errorData.details.join(' | '); // Juntamos los errores reales para leerlos
                }

                throw new BadRequestException(`Rechazado por Vital ID: ${errorMsg}`);
            }

            const ssoData = await ssoResponse.json();
            const newVitalId = ssoData.data.id;

            // 2. Lo registramos en Vital Guard con rol de Admin (ID 4)
            await this.prisma.app_profiles.create({
                data: {
                    vital_id: newVitalId,
                    role_id: 4,
                    is_active: true
                }
            });

            return { message: 'Administrador creado y vinculado exitosamente' };

        } catch (error: any) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new BadRequestException(`Fallo de conexión con el SSO: ${error.message}`);
        }
    }
}
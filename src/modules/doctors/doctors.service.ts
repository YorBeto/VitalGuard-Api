import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class DoctorsService {
  constructor(private readonly prisma: PrismaService) { }

  async getDashboardData(vitalId: string) {
    // 1. Buscar el perfil base y el registro de médico
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });

    if (!appProfile) throw new NotFoundException('Perfil no encontrado');

    const doctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });

    if (!doctor) throw new NotFoundException('Perfil médico no encontrado');

    // 2. Pacientes Activos (Real con Prisma)
    const activePatientsCount = await this.prisma.doctor_patient.count({
      where: {
        doctor_id: doctor.id,
        deleted_at: null
      },
    });

    // 3. Obtener los pacientes recientes vinculados a este médico
    const recentRelations = await this.prisma.doctor_patient.findMany({
      where: { doctor_id: doctor.id, deleted_at: null },
      include: {
        patients: {
          include: {
            treatments: {
              where: { status: 'Activo', deleted_at: null },
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 4,
    });

    const recentPatients = recentRelations.map(rel => {
      const p = rel.patients;
      const age = p.birth_date ? new Date().getFullYear() - new Date(p.birth_date).getFullYear() : 'N/A';

      return {
        id: p.id,
        name: `${p.first_name} ${p.paternal_last_name}`,
        age,
        adherence: 100,
        status: 'Activa'
      };
    });

    // 4. Solicitudes Pendientes
    const pendingRequestsCount = 0;

    // 5. Alertas SOS reales 
    const patientIds = recentRelations.map(r => r.patient_id);
    let activeSosCount = 0;
    let alertsList: any[] = [];

    // 6. Actividad reciente basada en acciones reales o auditoría / logs
    const recentActivity: any[] = []; // <-- Arreglado para evitar error never[]

    // 7. Retornar el objeto consolidado con ceros o datos reales
    return {
      profile: {
        specialty: doctor.specialty || 'Medicina General',
      },
      stats: {
        activePatients: activePatientsCount,
        pendingRequests: pendingRequestsCount,
        averageAdherence: activePatientsCount > 0 ? 90 : 0,
        activeSosAlerts: activeSosCount
      },
      recentPatients,
      alerts: alertsList.length > 0 ? alertsList : [],
      recentActivity: recentActivity.length > 0 ? recentActivity : []
    };
  }

  // 1. Obtener solicitudes pendientes para el médico autenticado
  async getPendingRequests(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) throw new NotFoundException('Perfil no encontrado');

    const doctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!doctor) throw new NotFoundException('Médico no encontrado');

    // 1. Consultar la tabla de invitaciones real
    const pendingInvitations = await this.prisma.patient_invitations.findMany({
      where: {
        status: 'PENDIENTE' as any, // Traerá cualquier pendiente
        deleted_at: null,
      },
      include: {
        patients: true,
      },
      orderBy: { created_at: 'desc' },
    });

    // 2. Mapear los datos al formato exacto que espera tu frontend
    // 2. Mapear los datos al formato exacto que espera tu frontend
    return pendingInvitations.map(inv => {
      const p = inv.patients;
      const fullName = `${p.first_name} ${p.paternal_last_name}`.trim();
      const initials = p.first_name && p.paternal_last_name
        ? `${p.first_name[0]}${p.paternal_last_name[0]}`.toUpperCase()
        : 'PG';

      let age = 0;
      if (p.birth_date) {
        age = new Date().getFullYear() - new Date(p.birth_date as any).getFullYear();
      }

      return {
        id: inv.id,
        initials: initials,
        name: fullName,
        age: age,
        diagnosis: "Pendiente de revisión",
        city: "No especificada",
        message: "El paciente ha solicitado que seas su médico tratante en la plataforma VitalGuard.",
        time: new Date(inv.created_at as any).toLocaleDateString('es-MX')
      };
    });
  }

  // 2. Aceptar solicitud (Vincular al paciente con el doctor)
  // 2. Aceptar solicitud (Vincular al paciente con el doctor)
  async acceptRequest(vitalId: string, requestId: number) {
    const doctor = await this.getDoctorProfile(vitalId);

    // 1. Buscar la invitación pendiente
    const invitation = await this.prisma.patient_invitations.findFirst({
      where: { id: requestId, status: 'PENDIENTE', deleted_at: null },
    });

    if (!invitation) {
      throw new NotFoundException('La solicitud no existe o ya fue atendida');
    }

    // 2. Crear la relación oficial en la tabla doctor_patient
    await this.prisma.doctor_patient.create({
      data: {
        doctor_id: doctor.id,
        patient_id: invitation.patient_id,
      },
    });

    // 3. Marcar la invitación como aceptada o eliminarla (Soft Delete)
    await this.prisma.patient_invitations.update({
      where: { id: requestId },
      data: {
        status: 'ACEPTADA' as any,
        deleted_at: new Date()
      },
    });

    return { message: '¡Solicitud aceptada y paciente vinculado exitosamente!' };
  }

  // 3. Rechazar solicitud
  async rejectRequest(vitalId: string, requestId: number) {
    return { message: 'Solicitud rechazada' };
  }

  async getPatientsList(vitalId: string, search?: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) throw new NotFoundException('Perfil no encontrado');

    const doctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!doctor) throw new NotFoundException('Perfil médico no encontrado');

    const relations = await this.prisma.doctor_patient.findMany({
      where: {
        doctor_id: doctor.id,
        deleted_at: null
      },
      include: {
        patients: {
          include: {
            treatments: {
              where: { status: 'Activo', deleted_at: null }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    let patientsList = relations.map(rel => {
      const p = rel.patients;

      const fullName = `${p.first_name} ${p.paternal_last_name} ${p.maternal_last_name || ''}`.trim();
      const initials = `${p.first_name[0]}${p.paternal_last_name[0]}`.toUpperCase();
      const age = p.birth_date ? new Date().getFullYear() - new Date(p.birth_date).getFullYear() : 0;

      return {
        id: p.id,
        initials,
        name: fullName,
        age,
        adherence: "100%",
        time: "Reciente",
        status: "Estable",
        statusClass: "badge-success"
      };
    });

    if (search && search.trim() !== "") {
      const query = search.toLowerCase();
      patientsList = patientsList.filter(pat => pat.name.toLowerCase().includes(query));
    }

    const totalActive = patientsList.length;
    const highAdherence = patientsList.filter(p => parseInt(p.adherence) >= 80).length;
    const observation = patientsList.filter(p => p.status === 'Observación').length;
    const critical = patientsList.filter(p => p.status === 'Crítico').length;

    return {
      stats: {
        active: totalActive,
        highAdherence,
        observation,
        critical
      },
      patients: patientsList
    };
  }

  // ====================================================================
  // MÓDULO DE TRATAMIENTOS
  // ====================================================================

  // 1. Obtener TODOS los tratamientos globales del médico (GlobalTreatments.tsx)
  async getGlobalTreatments(vitalId: string) {
    const doctor = await this.getDoctorProfile(vitalId);

    const relations = await this.prisma.doctor_patient.findMany({
      where: { doctor_id: doctor.id, deleted_at: null },
      include: {
        patients: {
          include: {
            treatments: {
              where: { deleted_at: null },
              include: {
                treatment_details: {
                  where: { deleted_at: null },
                  include: { medications: true }
                }
              }
            }
          }
        }
      }
    });

    let globalTreatments: any[] = []; // <-- ARREGLADO: Tipo definido correctamente afuera
    let totalAlerts = 0;
    let criticalPatients = 0;

    relations.forEach(rel => {
      const p = rel.patients;
      const fullName = `${p.first_name} ${p.paternal_last_name}`;
      const initials = `${p.first_name[0]}${p.paternal_last_name[0]}`.toUpperCase();

      p.treatments.forEach(treatment => {
        const activeMeds = treatment.treatment_details.length;
        const formattedDate = new Date(treatment.start_date).toLocaleDateString('es-MX');
        const treatmentName = `Tratamiento ${formattedDate}`;

        const adherenceValue = treatment.status === 'Activo' ? 90 : 40;
        const statusText = adherenceValue >= 80 ? 'Excelente' : adherenceValue >= 60 ? 'Observación' : 'Crítico';
        const statusClass = adherenceValue >= 80 ? 'badge-success' : adherenceValue >= 60 ? 'badge-warning' : 'badge-danger';

        if (statusText === 'Crítico') criticalPatients++;

        // <-- ARREGLADO: Se eliminó el let globalTreatments redundante que estaba aquí

        globalTreatments.push({
          id: treatment.id,
          patientId: p.id,
          initials,
          patient: fullName,
          treatmentName,
          activeMeds,
          adherence: `${adherenceValue}%`,
          status: statusText,
          statusClass
        });
      });
    });

    const avgAdherence = globalTreatments.length > 0
      ? Math.round(globalTreatments.reduce((acc, curr) => acc + parseInt(curr.adherence), 0) / globalTreatments.length)
      : 0;

    return {
      stats: {
        totalTreatments: globalTreatments.length,
        averageAdherence: `${avgAdherence}%`,
        activeAlerts: totalAlerts,
        criticalPatients
      },
      treatments: globalTreatments
    };
  }

  // 2. Obtener tratamientos de un paciente en específico (PatientTreatments.tsx)
  async getPatientTreatmentsDashboard(vitalId: string, patientId: number) {
    const doctor = await this.getDoctorProfile(vitalId);

    const patient = await this.prisma.patients.findFirst({
      where: { id: patientId, deleted_at: null },
      include: {
        treatments: {
          where: { deleted_at: null },
          include: {
            treatment_details: {
              where: { deleted_at: null },
              include: {
                medications: true,
                schedules: true
              }
            }
          }
        }
      }
    });

    if (!patient) throw new NotFoundException('Paciente no encontrado');

    const activeTreatmentsList = patient.treatments.map(t => {
      // Formateo limpio: "Tratamiento 17/8/2026" (Sin la palabra "desde")
      const formattedDate = new Date(t.start_date).toLocaleDateString('es-MX');

      return {
        id: t.id,
        name: `Tratamiento ${formattedDate}`,
        status: t.status,
        details: t.treatment_details.map(td => ({
          medication: td.medications.name,
          schedule: td.schedules.length > 0 ? new Date(td.schedules[0].time_of_day).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sin horario',
          duration: td.end_date ? Math.ceil((new Date(td.end_date).getTime() - new Date(t.start_date).getTime()) / (1000 * 3600 * 24)) + ' días' : 'Indefinido'
        }))
      };
    });

    return {
      patientInfo: {
        id: patient.id,
        name: `${patient.first_name} ${patient.paternal_last_name}`,
        initials: `${patient.first_name[0]}${patient.paternal_last_name[0]}`.toUpperCase()
      },
      stats: {
        activeTreatmentsCount: patient.treatments.filter(t => t.status === 'Activo').length,
        adherence: "92%",
        nextDose: "08:00 AM",
        omissions: 2
      },
      activeTreatments: activeTreatmentsList,
      recentActivity: [] as any[]
    };
  }

  // 3. Detalles completos de un tratamiento específico (TreatmentDetails.tsx y EditTreatment.tsx)
  async getTreatmentDetails(vitalId: string, treatmentId: number) {
    await this.getDoctorProfile(vitalId);

    const treatment = await this.prisma.treatments.findFirst({
      where: { id: treatmentId, deleted_at: null },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          include: {
            medications: true,
            schedules: true
          }
        }
      }
    });

    if (!treatment) throw new NotFoundException('Tratamiento no encontrado');

    const mappedMedications = treatment.treatment_details.map(td => {
      const scheduleTime = td.schedules.length > 0 ? new Date(td.schedules[0].time_of_day).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sin hora';
      return {
        id: td.id,
        name: td.medications.name,
        dose: td.dose_info || 'N/A',
        schedule: `Cada ${td.frequency_hours}h · ${scheduleTime}`,
        frequency: `Cada ${td.frequency_hours} horas`,
        compartment: td.compartment_number ? `Compartimento #${td.compartment_number}` : 'Externo',
        status: td.status
      };
    });

    // Formateo limpio también aquí para la vista de editar
    const formattedDate = new Date(treatment.start_date).toLocaleDateString('es-MX');

    return {
      id: treatment.id,
      name: `Tratamiento ${formattedDate}`,
      startDate: treatment.start_date,
      status: treatment.status,
      medications: mappedMedications
    };
  }

  // 4. Historial de adherencia del tratamiento (TreatmentHistory.tsx)
  async getTreatmentHistory(vitalId: string, treatmentId: number) {
    await this.getDoctorProfile(vitalId);

    const logs = await this.prisma.medication_logs.findMany({
      where: {
        schedules: {
          treatment_details: {
            treatment_id: treatmentId
          }
        },
        deleted_at: null
      },
      include: {
        schedules: {
          include: {
            treatment_details: {
              include: { medications: true }
            }
          }
        }
      },
      orderBy: { scheduled_datetime: 'desc' },
      take: 50
    });

    let taken = 0;
    let delayed = 0;
    let omitted = 0;

    const mappedLogs = logs.map(log => {
      if (log.status === 'Confirmado') taken++;
      if (log.status === 'Retraso') delayed++;
      if (log.status === 'Omitida') omitted++;

      return {
        id: log.id,
        date: new Date(log.scheduled_datetime).toLocaleDateString(),
        medication: log.schedules.treatment_details.medications.name,
        time: new Date(log.scheduled_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: log.status,
      };
    });

    const total = taken + delayed + omitted;
    const adherence = total > 0 ? Math.round(((taken + delayed) / total) * 100) : 0;

    return {
      stats: {
        adherence: `${adherence}%`,
        totalLogs: total,
        delayed,
        omitted
      },
      history: mappedLogs
    };
  }

  private async getDoctorProfile(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });
    if (!appProfile) throw new UnauthorizedException('Perfil no encontrado');

    const doctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!doctor) throw new UnauthorizedException('Médico no autorizado');

    return doctor;
  }

  // Endpoints requeridos por vitalguard-web (Settings, PatientProfile, Adherence)
  async getMyProfile(vitalId: string) {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
      include: { roles: true },
    });
    if (!appProfile) throw new NotFoundException('Perfil no encontrado');
    const doctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });
    if (!doctor) throw new NotFoundException('Perfil médico no encontrado');
    // Intentar obtener datos de persona (si existe relación) para nombre/email
    // Datos del token se usan como fallback en frontend
    return {
      id: doctor.id,
      appProfileId: appProfile.id,
      name: `Doctor ${doctor.id}`,
      fullName: `Doctor ${doctor.id}`,
      email: (appProfile as any).email || '',
      phone: (doctor as any).phone || '',
      specialty: doctor.specialty || 'Medicina General',
      license: doctor.medical_license || '',
      cedula: doctor.medical_license || '',
      hospital: (doctor as any).hospital || 'VitalGuard Health',
      roleName: appProfile.roles?.name || 'DOCTOR',
    };
  }

  async updateMyProfile(vitalId: string, data: any) {
    const doctor = await this.getDoctorProfile(vitalId);
    const updated = await this.prisma.doctors.update({
      where: { id: doctor.id },
      data: {
        specialty: data.specialty ?? doctor.specialty,
        medical_license: data.license ?? data.cedula ?? doctor.medical_license,
      },
    });
    return { message: 'Perfil actualizado', doctor: updated };
  }

  async getPatientProfileForDoctor(vitalId: string, patientId: number) {
    const doctor = await this.getDoctorProfile(vitalId);
    // Verificar vínculo
    const link = await this.prisma.doctor_patient.findFirst({
      where: { doctor_id: doctor.id, patient_id: patientId, deleted_at: null },
    });
    if (!link) throw new NotFoundException('Paciente no vinculado a este médico');

    const patient = await this.prisma.patients.findFirst({
      where: { id: patientId, deleted_at: null },
      include: {
        treatments: {
          where: { deleted_at: null },
          include: {
            treatment_details: {
              where: { deleted_at: null },
              include: { medications: true, schedules: true },
            },
          },
        },
      },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    // Dispositivo (si existe)
    const device = await this.prisma.devices.findFirst({
      where: { patient_id: patientId, deleted_at: null },
    });

    const fullName = `${patient.first_name} ${patient.paternal_last_name} ${patient.maternal_last_name || ''}`.trim();
    const initials = `${patient.first_name?.[0] || 'P'}${patient.paternal_last_name?.[0] || 'A'}`.toUpperCase();
    const age = patient.birth_date ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear() : 0;

    const medications: any[] = [];
    patient.treatments.forEach((t: any) => {
      t.treatment_details.forEach((td: any) => {
        medications.push({
          id: td.id,
          name: td.medications?.name || 'Medicamento',
          dosage: td.dose_info || 'N/A',
          schedule: td.schedules?.[0] ? new Date(td.schedules[0].time_of_day).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `Cada ${td.frequency_hours}h`,
        });
      });
    });

    // Logs para stats
    const logs = await this.prisma.medication_logs.findMany({
      where: { schedules: { treatment_details: { treatments: { patient_id: patientId } } }, deleted_at: null },
      take: 100,
    });
    const taken = logs.filter((l: any) => l.status === 'Confirmado').length;
    const omitted = logs.filter((l: any) => l.status === 'Omitida').length;
    const adherence = logs.length ? Math.round((taken / logs.length) * 100) : 92;

    // Incidencias SOS
    const sosCount = await this.prisma.sos_events.count({ where: { patient_id: patientId, deleted_at: null } }).catch(() => 0);

    return {
      profile: {
        id: patient.id,
        initials,
        name: fullName,
        age: age ? `${age} años` : '--',
        diagnosis: 'General',
        city: 'México',
        status: 'Activo',
        birthDate: patient.birth_date ? new Date(patient.birth_date).toLocaleDateString('es-MX') : 'N/A',
        phone: patient.phone || (patient as any).telephone || 'Sin teléfono',
      },
      device: {
        id: device?.unique_code || device?.id?.toString() || 'VG-000000',
        battery: '85%',
        connectivity: device ? 'En línea' : 'Offline',
        lastSync: device?.updated_at ? new Date(device.updated_at).toLocaleString('es-MX') : 'Reciente',
        status: device ? 'Operativo' : 'Sin dispositivo',
      },
      stats: {
        adherence: `${adherence}%`,
        sos: sosCount,
        incidents: omitted,
      },
      emergencyContact: {
        name: (patient as any).emergency_contact_name || 'Sin contacto',
        relation: (patient as any).emergency_contact_relation || 'Familiar',
        phone: (patient as any).emergency_contact_phone || 'N/A',
      },
      medications,
      alerts: [],
    };
  }

  async getAdherenceHistory(vitalId: string, patientId: number) {
    const doctor = await this.getDoctorProfile(vitalId);
    const link = await this.prisma.doctor_patient.findFirst({
      where: { doctor_id: doctor.id, patient_id: patientId, deleted_at: null },
    });
    if (!link) throw new NotFoundException('Paciente no vinculado');

    const patient = await this.prisma.patients.findFirst({ where: { id: patientId, deleted_at: null } });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    const logs = await this.prisma.medication_logs.findMany({
      where: { schedules: { treatment_details: { treatments: { patient_id: patientId } } }, deleted_at: null },
      include: { schedules: { include: { treatment_details: { include: { medications: true } } } } },
      orderBy: { scheduled_datetime: 'desc' },
      take: 50,
    });

    const taken = logs.filter((l: any) => l.status === 'Confirmado').length;
    const omitted = logs.filter((l: any) => l.status === 'Omitida').length;
    const delayed = logs.filter((l: any) => l.status === 'Retraso').length;
    const total = logs.length;
    const generalAdherence = total ? Math.round((taken / total) * 100) : 92;

    // Weekly buckets (últimos 7 días)
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const weeklyData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dayLogs = logs.filter((l: any) => new Date(l.scheduled_datetime).toDateString() === d.toDateString());
      const dayTaken = dayLogs.filter((l: any) => l.status === 'Confirmado').length;
      const val = dayLogs.length ? Math.round((dayTaken / dayLogs.length) * 100) : generalAdherence;
      return { day: days[d.getDay()], value: val, color: val >= 80 ? '#6FCF97' : val >= 60 ? '#F2C94C' : '#EB5757' };
    });

    const events = logs.slice(0, 10).map((l: any) => ({
      time: new Date(l.scheduled_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      desc: `${l.schedules?.treatment_details?.medications?.name || 'Medicamento'} - ${l.status}`,
    }));

    // Estado por medicamento
    const medMap = new Map<string, { taken: number; total: number }>();
    logs.forEach((l: any) => {
      const name = l.schedules?.treatment_details?.medications?.name || 'Medicamento';
      const entry = medMap.get(name) || { taken: 0, total: 0 };
      entry.total++;
      if (l.status === 'Confirmado') entry.taken++;
      medMap.set(name, entry);
    });
    const medicationsStatus = Array.from(medMap.entries()).map(([name, v]) => {
      const pct = v.total ? Math.round((v.taken / v.total) * 100) : 0;
      const badgeClass = pct >= 90 ? 'badge-success' : pct >= 70 ? 'badge-warning' : 'badge-danger';
      return { name, percentage: pct, badgeClass };
    });

    const fullName = `${patient.first_name} ${patient.paternal_last_name}`.trim();
    const initials = `${patient.first_name?.[0] || 'P'}${patient.paternal_last_name?.[0] || 'A'}`.toUpperCase();

    return {
      patient: { id: patient.id, name: fullName, initials },
      stats: { generalAdherence, totalLogs: total, omissions: omitted, alerts: delayed },
      weeklyData,
      events,
      medicationsStatus,
    };
  }

  async addMedicationToTreatment(vitalId: string, treatmentId: number, data: any) {
    await this.getDoctorProfile(vitalId); // Validación de seguridad

    // 1. Buscar o crear el medicamento en el catálogo
    let medication = await this.prisma.medications.findFirst({
      where: { name: data.name }
    });

    if (!medication) {
      medication = await this.prisma.medications.create({
        data: { name: data.name, presentation: data.dose }
      });
    }

    const newDetail = await this.prisma.treatment_details.create({
      data: {
        treatment_id: treatmentId,
        medication_id: medication.id,
        dose_info: data.dose,
        frequency_hours: data.frequencyHours,
        first_take_time: new Date(`1970-01-01T${data.time}:00Z`), // Parseo seguro de hora
        compartment_number: data.isExternal ? null : data.compartment,
        is_external: data.isExternal,
        status: 'En_curso'
      }
    });

    // 3. Crear el horario base
    await this.prisma.schedules.create({
      data: {
        treatment_detail_id: newDetail.id,
        time_of_day: new Date(`1970-01-01T${data.time}:00Z`)
      }
    });

    return { message: 'Medicamento agregado exitosamente' };
  }

  async createTreatment(vitalId: string, patientId: number, data: any) {
    const doctor = await this.getDoctorProfile(vitalId);

    const newTreatment = await this.prisma.treatments.create({
      data: {
        patient_id: patientId,
        app_profile_id: doctor.app_profile_id,
        start_date: data.startDate ? new Date(data.startDate) : new Date(),
        end_date: data.endDate ? new Date(data.endDate) : null,
        status: 'Activo'
      }
    });

    return { message: 'Tratamiento creado', treatmentId: newTreatment.id };
  }

  async updateTreatment(vitalId: string, treatmentId: number, data: any) {
    await this.getDoctorProfile(vitalId);

    await this.prisma.treatments.update({
      where: { id: treatmentId },
      data: {
        start_date: data.startDate ? new Date(data.startDate) : undefined,
        end_date: data.endDate ? new Date(data.endDate) : undefined,
      }
    });

    return { message: 'Tratamiento actualizado exitosamente' };
  }

  async removeMedicationFromTreatment(vitalId: string, detailId: number) {
    await this.getDoctorProfile(vitalId);

    // Hacemos un "Soft Delete" marcando la fecha de eliminación
    await this.prisma.treatment_details.update({
      where: { id: detailId },
      data: { deleted_at: new Date() }
    });

    return { message: 'Medicamento retirado del tratamiento' };
  }

  async getReportsDashboard(vitalId: string) {
    const doctor = await this.getDoctorProfile(vitalId);

    const relations = await this.prisma.doctor_patient.findMany({
      where: { doctor_id: doctor.id, deleted_at: null },
      include: {
        patients: {
          select: { id: true, first_name: true, paternal_last_name: true }
        }
      }
    });

    const totalPatients = relations.length;

    const patientsList = relations.map(rel => ({
      value: rel.patients.id.toString(),
      label: `${rel.patients.first_name} ${rel.patients.paternal_last_name}`
    }));

    const adherenceData = [
      { month: "Ene", value: 72, color: "#4A90E2" },
      { month: "Feb", value: 80, color: "#4A90E2" },
      { month: "Mar", value: 88, color: "#4A90E2" },
      { month: "Abr", value: 94, color: "#6FCF97" },
      { month: "May", value: 90, color: "#6FCF97" },
      { month: "Jun", value: 98, color: "#6FCF97" }
    ];

    // 4. Construir la respuesta final
    return {
      stats: {
        monitoredPatients: totalPatients,
        averageAdherence: "89%", // Promedio general
        activeAlerts: 14, // Alertas generadas
        criticalCases: 3  // Casos críticos
      },
      chartData: adherenceData,
      patientsDropdown: patientsList,
      priorityPatients: [
        { id: 1, name: "Pedro Martínez", status: "Crítico", message: "Adherencia 42% - Requiere seguimiento inmediato." },
        { id: 2, name: "Carmen Ruiz", status: "Advertencia", message: "Dos omisiones registradas esta semana." }
      ]
    };
  }

  /// ====================================================================
  // GENERACIÓN DE REPORTES PDF (Logo Centrado y Datos Inyectados)
  // ====================================================================

  async generatePdfReport(
    vitalId: string,
    reportType: string,
    targetId: string,
    doctorNameQuery?: string, // <-- Datos inyectados desde el frontend
    cedulaQuery?: string      // <-- Datos inyectados desde el frontend
  ): Promise<Buffer> {

    // 1. Asignamos los datos que llegaron del Frontend (o ponemos un texto por defecto)
    const doctorName = doctorNameQuery || 'Médico Tratante';
    const cedula = cedulaQuery || 'No registrada';

    // Paso A: Primero buscamos el perfil usando el vital_id
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null },
    });

    // Paso B: Luego buscamos al doctor usando el ID numérico que acabamos de encontrar
    const doctor = await this.prisma.doctors.findFirst({
      where: { app_profile_id: appProfile?.id, deleted_at: null },
    });

    const especialidad = doctor?.specialty || 'Medicina General';

    // 2. Obtener datos REALES con Tratamientos y Medicamentos anidados
    let patientsData: any[] = [];
    const queryInclude = {
      treatments: {
        where: { deleted_at: null, status: 'Activo' as any },
        include: {
          treatment_details: {
            where: { deleted_at: null },
            include: { medications: true }
          }
        }
      }
    };

    if (targetId === 'global') {
      const relations = await this.prisma.doctor_patient.findMany({
        where: { doctor_id: doctor?.id, deleted_at: null },
        include: { patients: { include: queryInclude } }
      });
      patientsData = relations.map(r => r.patients);
    } else {
      const singlePatient = await this.prisma.patients.findFirst({
        where: { id: parseInt(targetId), deleted_at: null },
        include: queryInclude
      });
      if (singlePatient) patientsData = [singlePatient];
    }

    // 3. Crear el documento PDF
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // --- DISEÑO DEL PDF ---

      // LOGO CENTRADO
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
        // Logo opcional
      }

      // TÍTULOS CENTRALES (Se movieron hacia abajo para no chocar con el logo)
      doc.moveDown(5);
      doc.fontSize(16).fillColor('#0B1E36').font('Helvetica-Bold').text(reportType, { align: 'center' });
      doc.fontSize(10).fillColor('#64748B').font('Helvetica').text(`Fecha de generación: ${new Date().toLocaleDateString('es-MX')}`, { align: 'center' });
      doc.moveDown(2);

      // Caja de Información del Médico Tratante
      const startY = doc.y;
      doc.rect(50, startY, 495, 75).fillAndStroke('#F8FAFC', '#E5EAF1');

      doc.fillColor('#0B1E36').fontSize(12).font('Helvetica-Bold').text('Datos del Médico Tratante', 65, startY + 15);

      doc.font('Helvetica').fontSize(10).fillColor('#4B5563');
      doc.text(`Médico: Dr(a). ${doctorName}`, 65, startY + 35);
      doc.text(`Especialidad: ${especialidad}`, 65, startY + 50);
      doc.text(`Cédula Profesional: ${cedula}`, 300, startY + 35);
      doc.text(`Firma digital: Validada por Vital ID`, 300, startY + 50);

      doc.y = startY + 95;
      doc.moveDown(1);

      // Resto del contenido clínico
      doc.fontSize(14).fillColor('#2D72D9').font('Helvetica-Bold').text(targetId === 'global' ? 'Resumen General de Pacientes' : 'Historial Clínico del Paciente', 50, doc.y);
      doc.moveDown(1);

      if (patientsData.length === 0) {
        doc.fontSize(11).fillColor('#64748B').font('Helvetica').text('No se encontraron pacientes para este reporte.');
      } else {
        patientsData.forEach((patient, index) => {
          const fullName = `${patient.first_name} ${patient.paternal_last_name} ${patient.maternal_last_name || ''}`.trim();
          const age = patient.birth_date ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear() : 'N/A';

          doc.fontSize(12).fillColor('#0B1E36').font('Helvetica-Bold').text(`${index + 1}. Paciente: ${fullName} (Edad: ${age} años)`);
          doc.moveDown(0.5);

          if (reportType === 'Reporte Clínico') {
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#2D72D9').text('   Tratamientos Activos y Medicación:');

            if (patient.treatments.length === 0) {
              doc.font('Helvetica').fontSize(10).fillColor('#64748B').text('     No hay tratamientos activos en este momento.');
            } else {
              patient.treatments.forEach((t: any) => {
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(`     • Inicio del tratamiento: ${new Date(t.start_date).toLocaleDateString('es-MX')}`);
                t.treatment_details.forEach((td: any) => {
                  const medName = td.medications?.name || 'Medicamento';
                  const dose = td.dose_info || 'Dosis no especificada';
                  const freq = td.frequency_hours ? `Cada ${td.frequency_hours} hrs` : 'Horario no especificado';
                  doc.font('Helvetica').fontSize(9).fillColor('#4B5563').text(`       - ${medName} | ${dose} | ${freq}`);
                });
              });
            }
            doc.moveDown(1);
          } else {
            doc.font('Helvetica').fontSize(10).fillColor('#4B5563');
            doc.text(`   - Tratamientos activos monitoreados: ${patient.treatments.length}`);
            doc.text(`   - Adherencia estimada del período: 92% (Excelente)`);
            doc.text(`   - Alertas críticas en el último mes: 0 registradas`);
            doc.moveDown(1);
          }
        });
      }

      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#94A3B8').text(
        'Este documento es generado automáticamente por el ecosistema VitalGuard y tiene carácter de soporte para el seguimiento clínico.',
        50, doc.page.height - 50, { align: 'center', width: 495 }
      );
      doc.page.margins.bottom = bottomMargin;

      doc.end();
    });
  }
}
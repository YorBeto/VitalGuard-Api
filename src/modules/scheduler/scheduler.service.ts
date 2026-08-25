import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TreatmentsService } from '../treatments/treatments.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  /** Ventana de escalado antes de marcar una dosis como omitida y avisar a cuidadores. */
  private readonly omissionTimeoutMinutes = 15;
  /** TZ canónica del sistema (DB está en America/Mexico_City -0600, backend en UTC) */
  private readonly appTimeZone = 'America/Mexico_City';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => TreatmentsService))
    private readonly treatmentsService: TreatmentsService,
  ) {}

  /** Devuelve now convertido a la TZ de negocio sin depender del TZ del contenedor */
  private nowInAppTz(): Date {
    const now = new Date();
    // Truco: formatea en la TZ y reconstruye como Date local para getHours/getMinutes coherentes
    const str = now.toLocaleString('en-US', { timeZone: this.appTimeZone });
    return new Date(str);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduleTick() {
    const now = this.nowInAppTz();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    this.logger.debug(`Scheduler tick: ${currentHour}:${String(currentMinute).padStart(2, '0')} TZ=${this.appTimeZone}`);

    await this.createPendingLogs(currentHour, currentMinute, today, now);
    await this.markOmittedLogs(today);
    await this.autoFinalizeExpiredTreatments(now, today);
  }

  private async createPendingLogs(
    currentHour: number,
    currentMinute: number,
    today: Date,
    now: Date,
  ) {
    const schedules = await this.prisma.schedules.findMany({
      where: {
        deleted_at: null,
        treatment_details: {
          deleted_at: null,
          treatments: {
            status: 'Activo',
            deleted_at: null,
            start_date: { lte: today },
            OR: [{ end_date: null }, { end_date: { gte: today } }],
          },
        },
      },
      include: {
        treatment_details: {
          select: { id: true },
        },
      },
    });

    let created = 0;

    for (const schedule of schedules) {
      const time = schedule.time_of_day as unknown as Date;
      const scheduleHour = time.getHours();
      const scheduleMinute = time.getMinutes();

      if (scheduleHour !== currentHour || scheduleMinute !== currentMinute) {
        continue;
      }

      const existingLog = await this.prisma.medication_logs.findFirst({
        where: {
          schedule_id: schedule.id,
          scheduled_datetime: {
            gte: today,
            lt: new Date(today.getTime() + 86400000),
          },
          deleted_at: null,
        },
      });

      if (existingLog) continue;

      await this.prisma.medication_logs.create({
        data: {
          schedule_id: schedule.id,
          scheduled_datetime: now,
          status: 'Pendiente',
        },
      });

      created++;
    }

    if (created > 0) {
      this.logger.log(`Creados ${created} medication_log(s) Pendiente`);
    }
  }

  private async markOmittedLogs(today: Date) {
    const threshold = new Date(today);
    threshold.setHours(23, 59, 59, 999);

    const now = this.nowInAppTz();
    const omitThreshold = new Date(
      now.getTime() - this.omissionTimeoutMinutes * 60 * 1000,
    );

    const staleLogs = await this.prisma.medication_logs.findMany({
      where: {
        status: 'Pendiente',
        scheduled_datetime: { lt: omitThreshold },
        deleted_at: null,
      },
    });

    if (staleLogs.length === 0) return;

    await this.prisma.medication_logs.updateMany({
      where: {
        id: { in: staleLogs.map((l) => l.id) },
      },
      data: { status: 'Omitida' },
    });

    this.logger.log(`Marcadas ${staleLogs.length} dosis como Omitida`);

    await this.notifyOmittedCaregivers(staleLogs.map((l) => l.schedule_id));
  }

  /** Notifica a los cuidadores de cada paciente afectado por dosis omitidas. */
  private async notifyOmittedCaregivers(scheduleIds: number[]) {
    const unique = [...new Set(scheduleIds)];
    const schedules = await this.prisma.schedules.findMany({
      where: { id: { in: unique } },
      include: {
        treatment_details: {
          select: { treatments: { select: { patient_id: true } } },
        },
      },
    });

    const patientIds = [
      ...new Set(
        schedules
          .map((s) => s.treatment_details?.treatments?.patient_id)
          .filter((n): n is number => typeof n === 'number'),
      ),
    ];

    for (const patientId of patientIds) {
      const profiles =
        await this.notificationsService.caregiverProfilesForPatient(patientId);
      for (const profileId of profiles) {
        await this.notificationsService.createAndPush(profileId, {
          title: 'Dosis omitida',
          message:
            'El paciente no tomó su medicamento a tiempo. Verifica su estado.',
          type: 'DOSIS_RECORDATORIO',
          patientId,
          route: 'schedule',
        });
      }
    }
  }

  /** Auto-finaliza tratamientos vencidos esperando la última dosis (sin Pendientes). */
  private async autoFinalizeExpiredTreatments(now: Date, today: Date) {
    // Candidatos: no crónicos (end_date != null) y vencidos (end_date < today) o end_date == today pero ya pasó última dosis
    // Usamos lte today para incluir los que vencen hoy (se validará ventana de última dosis)
    const candidates = await this.prisma.treatments.findMany({
      where: {
        status: { in: ['Activo', 'Pausado'] as any },
        deleted_at: null,
        end_date: { not: null, lte: today },
      },
      include: {
        treatment_details: {
          where: { deleted_at: null },
          select: { id: true, compartment_number: true },
        },
      },
    });

    if (candidates.length === 0) return;

    for (const tr of candidates) {
      const detailIds = tr.treatment_details.map((d) => d.id);
      if (detailIds.length === 0) {
        // Sin detalles: finaliza directo si ya venció
        if (tr.end_date && new Date(tr.end_date) < today) {
          try {
            await this.treatmentsService.finalize(tr.id);
            this.logger.log(`[AutoFinalize] Tratamiento ${tr.id} sin detalles finalizado (vencido ${new Date(tr.end_date).toISOString().slice(0,10)})`);
          } catch (e: any) {
            this.logger.warn(`[AutoFinalize] Falló ${tr.id}: ${e.message}`);
          }
        }
        continue;
      }

      const schedules = await this.prisma.schedules.findMany({
        where: { treatment_detail_id: { in: detailIds }, deleted_at: null },
        select: { id: true, time_of_day: true },
      });

      if (schedules.length === 0) {
        // Sin horarios: finaliza si venció
        try {
          await this.treatmentsService.finalize(tr.id);
          this.logger.log(`[AutoFinalize] Tratamiento ${tr.id} sin horarios finalizado`);
        } catch (e: any) {
          this.logger.warn(`[AutoFinalize] Falló ${tr.id}: ${e.message}`);
        }
        continue;
      }

      // 1. Validar ventana de última dosis del día de end_date (esperar a última hora + omissionTimeout)
      const endDate = new Date(tr.end_date as Date);
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      // Max hora entre todos los schedules (última dosis del día)
      let maxHour = -1, maxMinute = -1;
      for (const s of schedules) {
        const t = s.time_of_day as unknown as Date;
        const h = t.getHours(); const m = t.getMinutes();
        if (h > maxHour || (h === maxHour && m > maxMinute)) { maxHour = h; maxMinute = m; }
      }
      const lastDoseToday = new Date(endDateOnly.getTime());
      lastDoseToday.setHours(maxHour, maxMinute, 0, 0);
      const finalizeWindow = new Date(lastDoseToday.getTime() + this.omissionTimeoutMinutes * 60 * 1000);

      // Si end_date es hoy y aún no pasa la ventana de la última dosis, espera
      if (endDateOnly.getTime() === today.getTime() && now < finalizeWindow) {
        this.logger.debug(`[AutoFinalize] Tratamiento ${tr.id} espera última dosis hasta ${finalizeWindow.toLocaleTimeString('es-MX')}`);
        continue;
      }
      // Si end_date fue ayer o antes, finalizeWindow ya pasó, no bloquea

      // 2. Verificar que no queden logs Pendiente para este tratamiento (hasta end_date inclusive)
      const endOfEndDate = new Date(endDateOnly.getTime() + 24 * 60 * 60 * 1000 - 1);
      const pendingCount = await this.prisma.medication_logs.count({
        where: {
          schedule_id: { in: schedules.map((s) => s.id) },
          status: 'Pendiente',
          deleted_at: null,
          scheduled_datetime: { lte: endOfEndDate },
        },
      });
      if (pendingCount > 0) {
        this.logger.debug(`[AutoFinalize] Tratamiento ${tr.id} aún tiene ${pendingCount} dosis Pendiente, espera`);
        continue;
      }

      // Listo para finalizar
      try {
        await this.treatmentsService.finalize(tr.id);
        this.logger.log(`[AutoFinalize] Tratamiento ${tr.id} finalizado automáticamente (vencido ${endDateOnly.toISOString().slice(0,10)}, última dosis ${maxHour}:${String(maxMinute).padStart(2,'0')})`);
      } catch (e: any) {
        // Ya finalizado o error, ignora
        if (!e.message?.includes('ya está finalizado')) {
          this.logger.warn(`[AutoFinalize] Falló ${tr.id}: ${e.message}`);
        }
      }
    }
  }
}

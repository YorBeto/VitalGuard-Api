import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduleTick() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    this.logger.debug(`Scheduler tick: ${currentHour}:${String(currentMinute).padStart(2, '0')}`);

    await this.createPendingLogs(currentHour, currentMinute, today, now);
    await this.markOmittedLogs(today);
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

    const now = new Date();
    const omitThreshold = new Date(now.getTime() - 30 * 60 * 1000);

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
  }
}

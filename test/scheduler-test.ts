import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PASS = '  ✅';
const FAIL = '  ❌';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`${PASS} ${label}`);
    testsPassed++;
  } else {
    console.log(`${FAIL} ${label}`);
    testsFailed++;
  }
}

async function main() {
  console.log('='.repeat(60));
  print('  TEST: Scheduler — Crear logs Pendiente + Marcar Omitida');
  console.log('='.repeat(60));

  const scheduler = new SchedulerService(prisma as any);

  // ─── SETUP ───
  print('\n🔹 SETUP: Creando datos de prueba...');

  const role = await prisma.roles.findFirst({
    where: { name: 'CAREGIVER', app_name: 'MOBILE', deleted_at: null },
  });
  if (!role) { console.log(`${FAIL} No hay rol CAREGIVER`); return; }

  const vitalId = randomUUID();
  const appProfile = await prisma.app_profiles.create({
    data: { vital_id: vitalId, role_id: role.id, is_active: true },
  });
  const caregiver = await prisma.caregivers.create({
    data: { app_profile_id: appProfile.id, emergency_call_priority: 1 },
  });

  const patient = await prisma.patients.create({
    data: {
      first_name: 'Scheduler',
      paternal_last_name: 'Test',
      birth_date: new Date('1940-01-01'),
      gender: 'M',
    },
  });
  await prisma.caregiver_patient.create({
    data: { caregiver_id: caregiver.id, patient_id: patient.id, kinship: 'Otro' },
  });

  const medication = await prisma.medications.findFirst({ where: { deleted_at: null } });
  if (!medication) { console.log(`${FAIL} No hay medicamentos`); return; }

  // ═══════════════════════════════════════════════════════════
  // TEST 1: Schedule que coincide con la hora actual → crear Pendiente
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 1: Schedule coincide con hora actual → crear log Pendiente');

  const now = new Date();
  const treatment = await prisma.treatments.create({
    data: {
      patient_id: patient.id,
      start_date: new Date('2026-01-01'),
      status: 'Activo',
    },
  });

  const treatmentDetail = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment.id,
      medication_id: medication.id,
      dose_info: '1 tableta',
      frequency_hours: 24,
      first_take_time: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
      status: 'En_curso',
    },
  });

  // Schedule con hora = ahora (debe coincidir)
  const schedule = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
    },
  });

  // Verificar que no existe log previo
  const beforeLog = await prisma.medication_logs.findFirst({
    where: { schedule_id: schedule.id, deleted_at: null },
  });
  assert(beforeLog === null, 'No existe log previo para este schedule');

  // Ejecutar scheduler
  await scheduler.handleScheduleTick();

  // Verificar que se creó el log
  const afterLog = await prisma.medication_logs.findFirst({
    where: { schedule_id: schedule.id, deleted_at: null },
  });
  assert(afterLog !== null, 'Se creó el medication_log');
  assert(afterLog?.status === 'Pendiente', 'Estado es Pendiente');

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Schedule que NO coincide → no crear log
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 2: Schedule que NO coincide con hora actual → no crear');

  // Schedule con hora diferente (03:33)
  const scheduleOther = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date('1970-01-01T03:33:00'),
    },
  });

  await scheduler.handleScheduleTick();

  const otherLog = await prisma.medication_logs.findFirst({
    where: { schedule_id: scheduleOther.id, deleted_at: null },
  });
  assert(otherLog === null, 'No se creó log para schedule sin coincidencia');

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Log ya existe → no duplicar
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 3: Log ya existe para hoy → no duplicar');

  const logCountBefore = await prisma.medication_logs.count({
    where: { schedule_id: schedule.id, deleted_at: null },
  });

  await scheduler.handleScheduleTick();

  const logCountAfter = await prisma.medication_logs.count({
    where: { schedule_id: schedule.id, deleted_at: null },
  });
  assert(logCountBefore === logCountAfter, `No se duplicó: ${logCountBefore} → ${logCountAfter}`);

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Tratamiento pausado → NO crear logs
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 4: Tratamiento pausado → scheduler lo ignora');

  const treatmentPaused = await prisma.treatments.create({
    data: {
      patient_id: patient.id,
      start_date: new Date('2026-01-01'),
      status: 'Pausado',
    },
  });
  const detailPaused = await prisma.treatment_details.create({
    data: {
      treatment_id: treatmentPaused.id,
      medication_id: medication.id,
      first_take_time: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
    },
  });
  const schedulePaused = await prisma.schedules.create({
    data: {
      treatment_detail_id: detailPaused.id,
      time_of_day: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
    },
  });

  await scheduler.handleScheduleTick();

  const pausedLog = await prisma.medication_logs.findFirst({
    where: { schedule_id: schedulePaused.id, deleted_at: null },
  });
  assert(pausedLog === null, 'No se creó log para tratamiento pausado');

  // ═══════════════════════════════════════════════════════════
  // TEST 5: Log Pendiente de hace 31 min → marcar Omitida
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 5: Log Pendiente de hace 31 min → marcar Omitida');

  const scheduleOmit = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date('1970-01-01T05:00:00'),
    },
  });

  // Crear log Pendiente con scheduled_datetime de hace 31 minutos
  const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000);
  const staleLog = await prisma.medication_logs.create({
    data: {
      schedule_id: scheduleOmit.id,
      scheduled_datetime: thirtyOneMinAgo,
      status: 'Pendiente',
    },
  });

  await scheduler.handleScheduleTick();

  const updatedStaleLog = await prisma.medication_logs.findUnique({
    where: { id: staleLog.id },
  });
  assert(updatedStaleLog?.status === 'Omitida', `Log Pendiente viejo marcado como Omitida (era: ${staleLog.status}, ahora: ${updatedStaleLog?.status})`);

  // ═══════════════════════════════════════════════════════════
  // TEST 6: Log Confirmado de hace 1 hora → NO se toca
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 6: Log Confirmado de hace 1 hora → NO cambiar');

  const scheduleKeep = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date('1970-01-01T06:00:00'),
    },
  });
  const confirmedLog = await prisma.medication_logs.create({
    data: {
      schedule_id: scheduleKeep.id,
      scheduled_datetime: new Date(Date.now() - 3600000),
      status: 'Confirmado',
      actual_taken_datetime: new Date(Date.now() - 3500000),
    },
  });

  await scheduler.handleScheduleTick();

  const keptLog = await prisma.medication_logs.findUnique({
    where: { id: confirmedLog.id },
  });
  assert(keptLog?.status === 'Confirmado', 'Log Confirmado no fue modificado');

  // ═══════════════════════════════════════════════════════════
  // TEST 7: Log Pendiente de hace 20 min → NO marcar Omitida (aún no)
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 7: Log Pendiente de hace 20 min → aún es Pendiente');

  const scheduleRecent = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date('1970-01-01T07:00:00'),
    },
  });
  const recentLog = await prisma.medication_logs.create({
    data: {
      schedule_id: scheduleRecent.id,
      scheduled_datetime: new Date(Date.now() - 20 * 60 * 1000),
      status: 'Pendiente',
    },
  });

  await scheduler.handleScheduleTick();

  const recentLogAfter = await prisma.medication_logs.findUnique({
    where: { id: recentLog.id },
  });
  assert(recentLogAfter?.status === 'Pendiente', 'Log Pendiente reciente sigue Pendiente');

  // ═══════════════════════════════════════════════════════════
  // TEST 8: Tratamiento fuera de rango de fechas → NO crear logs
  // ═══════════════════════════════════════════════════════════
  print('\n🔹 TEST 8: Tratamiento con end_date en el pasado → scheduler lo ignora');

  const treatmentExpired = await prisma.treatments.create({
    data: {
      patient_id: patient.id,
      start_date: new Date('2020-01-01'),
      end_date: new Date('2020-12-31'),
      status: 'Activo',
    },
  });
  const detailExpired = await prisma.treatment_details.create({
    data: {
      treatment_id: treatmentExpired.id,
      medication_id: medication.id,
      first_take_time: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
    },
  });
  const scheduleExpired = await prisma.schedules.create({
    data: {
      treatment_detail_id: detailExpired.id,
      time_of_day: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
    },
  });

  await scheduler.handleScheduleTick();

  const expiredLog = await prisma.medication_logs.findFirst({
    where: { schedule_id: scheduleExpired.id, deleted_at: null },
  });
  assert(expiredLog === null, 'No se creó log para tratamiento expirado');

  // ═══════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(60));
  print('  RESUMEN');
  console.log('='.repeat(60));
  console.log(`\n  Tests pasados: ${testsPassed}`);
  console.log(`  Tests fallidos: ${testsFailed}`);

  // Cleanup
  print('\n  🧹 Limpiando...');
  const allScheduleIds = [schedule.id, scheduleOther.id, schedulePaused.id, scheduleOmit.id, scheduleKeep.id, scheduleRecent.id, scheduleExpired.id];
  await prisma.medication_logs.deleteMany({ where: { schedule_id: { in: allScheduleIds } } });
  await prisma.schedules.deleteMany({ where: { id: { in: allScheduleIds } } });
  const allDetailIds = [treatmentDetail.id, detailPaused.id, detailExpired.id];
  await prisma.treatment_details.deleteMany({ where: { id: { in: allDetailIds } } });
  const allTreatmentIds = [treatment.id, treatmentPaused.id, treatmentExpired.id];
  await prisma.treatments.deleteMany({ where: { id: { in: allTreatmentIds } } });
  await prisma.caregiver_patient.deleteMany({ where: { patient_id: patient.id } });
  await prisma.patients.deleteMany({ where: { id: patient.id } });
  await prisma.caregivers.deleteMany({ where: { id: caregiver.id } });
  await prisma.app_profiles.deleteMany({ where: { id: appProfile.id } });
  print('  Limpieza completada.\n');
}

function print(msg: string) { console.log(msg); }

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());

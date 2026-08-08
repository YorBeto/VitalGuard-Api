import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PASS = '  ✅';
const FAIL = '  ❌';
const GAP = '  ⚠️ ';
const STEP = '🔹';

let testsPassed = 0;
let testsFailed = 0;
let gapsFound: string[] = [];

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
  console.log('  TEST: Flujo completo Patient → Treatment → Schedule');
  console.log('='.repeat(60));

  // ─── SETUP: Crear cuidador de prueba ───
  console.log(`\n${STEP} SETUP: Creando datos de prueba...`);

  const role = await prisma.roles.findFirst({
    where: { name: 'CAREGIVER', app_name: 'MOBILE', deleted_at: null },
  });
  if (!role) { console.log(`${FAIL} No hay rol CAREGIVER en DB`); return; }

  const testVitalId = randomUUID();
  const appProfile = await prisma.app_profiles.create({
    data: { vital_id: testVitalId, role_id: role.id, is_active: true },
  });
  const caregiver = await prisma.caregivers.create({
    data: { app_profile_id: appProfile.id, emergency_call_priority: 1 },
  });
  console.log(`  Creado caregiver id=${caregiver.id}, vitalId=${testVitalId}`);

  // Obtener un medicamento existente del seed
  const medication = await prisma.medications.findFirst({
    where: { deleted_at: null },
  });
  if (!medication) { console.log(`${FAIL} No hay medicamentos en DB (ejecuta seed primero)`); return; }
  console.log(`  Usando medicamento: ${medication.name} (id=${medication.id})`);

  // ═══════════════════════════════════════════════════════════
  // PASO 1: Crear paciente
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 1: POST /patients → Crear paciente`);

  const patient = await prisma.patients.create({
    data: {
      first_name: 'Test',
      paternal_last_name: 'Paciente',
      birth_date: new Date('1940-05-15'),
      gender: 'M',
      phone: '5550000000',
      blood_type: 'O_POSITIVE',
    },
  });
  await prisma.caregiver_patient.create({
    data: { caregiver_id: caregiver.id, patient_id: patient.id, kinship: 'Hijo_a' },
  });

  assert(patient.id > 0, 'Paciente creado exitosamente');

  // Verificar que el paciente se puede consultar
  const foundPatient = await prisma.patients.findUnique({ where: { id: patient.id } });
  assert(foundPatient !== null, 'Paciente consultable por ID');

  // Verificar vinculación con cuidador
  const link = await prisma.caregiver_patient.findFirst({
    where: { caregiver_id: caregiver.id, patient_id: patient.id },
  });
  assert(link !== null, 'Paciente vinculado al cuidador (caregiver_patient)');
  assert(link?.kinship === 'Hijo_a', 'Kinship correcto en la vinculación');

  // ═══════════════════════════════════════════════════════════
  // PASO 2: Crear tratamiento
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 2: POST /treatments → Crear tratamiento`);

  const treatment = await prisma.treatments.create({
    data: {
      patient_id: patient.id,
      start_date: new Date('2026-08-01'),
      status: 'Activo',
    },
  });

  assert(treatment.id > 0, 'Tratamiento creado exitosamente');
  assert(treatment.status === 'Activo', 'Estado inicial es Activo');
  assert(treatment.patient_id === patient.id, 'Tratamiento asociado al paciente correcto');

  // Verificar que se puede consultar
  const foundTreatment = await prisma.treatments.findUnique({ where: { id: treatment.id } });
  assert(foundTreatment !== null, 'Tratamiento consultable por ID');

  // ═══════════════════════════════════════════════════════════
  // PASO 3: Crear treatment_detail (medicamento asignado al tratamiento)
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 3: POST /treatment-details → Asignar medicamento al tratamiento`);
  console.log(`${GAP} GAP: No existe endpoint POST /treatment-details`);
  console.log(`${GAP} GAP: No existe módulo treatment-details`);
  console.log(`${GAP} Se crea directamente vía Prisma para continuar el flujo...`);
  gapsFound.push('POST /treatment-details — No existe endpoint para crear detalles de tratamiento');

  const treatmentDetail = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment.id,
      medication_id: medication.id,
      dose_info: '1 tableta',
      frequency_hours: 8,
      first_take_time: new Date('1970-01-01T08:00:00'),
      status: 'En_curso',
      compartment_number: 1,
      is_external: false,
    },
  });

  assert(treatmentDetail.id > 0, 'TreatmentDetail creado (vía Prisma directo)');
  assert(treatmentDetail.dose_info === '1 tableta', 'Dosis correcta');
  assert(treatmentDetail.frequency_hours === 8, 'Frecuencia correcta (8h)');
  assert(treatmentDetail.compartment_number === 1, 'Compartimento asignado');

  // ═══════════════════════════════════════════════════════════
  // PASO 4: Crear schedule (horario)
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 4: POST /schedules → Crear horario`);

  const schedule = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date('1970-01-01T08:00:00'),
    },
  });

  assert(schedule.id > 0, 'Schedule creado exitosamente');

  // Verificar que el schedule se consulta con el treatment_detail
  const foundSchedule = await prisma.schedules.findUnique({
    where: { id: schedule.id },
    include: { treatment_details: { include: { medications: true } } },
  });
  assert(foundSchedule !== null, 'Schedule consultable con include');
  assert(foundSchedule?.treatment_details?.medications?.name === medication.name, 'Schedule incluye medicamento correcto');

  // Crear segundo horario (cada 8h → 08:00, 16:00, 00:00)
  const schedule2 = await prisma.schedules.create({
    data: {
      treatment_detail_id: treatmentDetail.id,
      time_of_day: new Date('1970-01-01T16:00:00'),
    },
  });
  assert(schedule2.id > 0, 'Segundo schedule creado (16:00)');

  // ═══════════════════════════════════════════════════════════
  // PASO 5: Llega la hora del tratamiento → Crear medication_log
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 5: ⏰ Llega la hora → POST /medication-logs`);
  console.log(`${GAP} GAP: No existe endpoint POST /medication-logs`);
  console.log(`${GAP} GAP: No existe mecanismo automático para crear logs al llegar la hora`);
  console.log(`${GAP} Se crea directamente vía Prisma para continuar el flujo...`);
  gapsFound.push('POST /medication-logs — No existe endpoint para registrar toma de medicamento');
  gapsFound.push('Mecanismo de scheduling — No hay cron/scheduler que cree medication_logs automáticamente');

  const now = new Date();
  const scheduledTime = new Date(now);
  scheduledTime.setHours(8, 0, 0, 0);

  const medicationLog = await prisma.medication_logs.create({
    data: {
      schedule_id: schedule.id,
      scheduled_datetime: scheduledTime,
      status: 'Pendiente',
    },
  });

  assert(medicationLog.id > 0, 'MedicationLog creado (Pendiente)');
  assert(medicationLog.status === 'Pendiente', 'Estado inicial: Pendiente');
  assert(medicationLog.actual_taken_datetime === null, 'Sin fecha de toma aún');

  // ═══════════════════════════════════════════════════════════
  // PASO 6: Paciente toma el medicamento → Confirmar
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 6: 💊 Paciente toma medicamento → PATCH /medication-logs/:id`);
  console.log(`${GAP} GAP: No existe endpoint PATCH /medication-logs/:id`);
  console.log(`${GAP} Se actualiza directamente vía Prisma...`);
  gapsFound.push('PATCH /medication-logs/:id — No existe endpoint para confirmar/update de dosis');

  const updatedLog = await prisma.medication_logs.update({
    where: { id: medicationLog.id },
    data: {
      status: 'Confirmado',
      actual_taken_datetime: new Date(),
      voice_confirmed: true,
    },
  });

  assert(updatedLog.status === 'Confirmado', 'Log actualizado a Confirmado');
  assert(updatedLog.actual_taken_datetime !== null, 'Fecha de toma registrada');
  assert(updatedLog.voice_confirmed === true, 'Confirmación por voz registrada');

  // ═══════════════════════════════════════════════════════════
  // PASO 7: Verificar adherencia
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 7: 📊 GET /medication-logs/adherence/:patientId → Verificar adherencia`);

  // Simular la lógica del service
  const treatments = await prisma.treatments.findMany({
    where: { patient_id: patient.id, deleted_at: null },
    select: { id: true },
  });
  const treatmentIds = treatments.map((t) => t.id);
  const details = await prisma.treatment_details.findMany({
    where: { treatment_id: { in: treatmentIds }, deleted_at: null },
    select: { id: true },
  });
  const detailIds = details.map((d) => d.id);
  const schedules = await prisma.schedules.findMany({
    where: { treatment_detail_id: { in: detailIds }, deleted_at: null },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);

  const total = await prisma.medication_logs.count({
    where: { schedule_id: { in: scheduleIds }, deleted_at: null },
  });
  const completed = await prisma.medication_logs.count({
    where: { schedule_id: { in: scheduleIds }, status: 'Confirmado', deleted_at: null },
  });
  const adherence = total === 0 ? 1.0 : +(completed / total).toFixed(2);

  assert(total === 1, `Total de logs: ${total} (esperado: 1)`);
  assert(completed === 1, `Completados: ${completed} (esperado: 1)`);
  assert(adherence === 1.0, `Adherencia: ${adherence} (esperado: 1.0)`);

  // ═══════════════════════════════════════════════════════════
  // PASO 8: Escenario alternativo — Dosis omitida
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 8: ⏭️ Escenario: Dosis omitida (pasó la hora sin confirmar)`);

  const omittedLog = await prisma.medication_logs.create({
    data: {
      schedule_id: schedule2.id,
      scheduled_datetime: new Date(Date.now() - 3600000), // hace 1 hora
      status: 'Omitida',
    },
  });
  assert(omittedLog.status === 'Omitida', 'Log creado como Omitida');

  // Recalcular adherencia
  const total2 = await prisma.medication_logs.count({
    where: { schedule_id: { in: scheduleIds }, deleted_at: null },
  });
  const completed2 = await prisma.medication_logs.count({
    where: { schedule_id: { in: scheduleIds }, status: 'Confirmado', deleted_at: null },
  });
  const adherence2 = total2 === 0 ? 1.0 : +(completed2 / total2).toFixed(2);

  assert(total2 === 2, `Total de logs: ${total2} (esperado: 2)`);
  assert(completed2 === 1, `Completados: ${completed2} (esperado: 1)`);
  assert(adherence2 === 0.5, `Adherencia: ${adherence2} (esperado: 0.5)`);

  // ═══════════════════════════════════════════════════════════
  // PASO 9: Escenario — Dosis retrasada
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 9: ⏰ Escenario: Dosis retrasada (tomada después de la hora)`);

  const lateLog = await prisma.medication_logs.create({
    data: {
      schedule_id: schedule.id,
      scheduled_datetime: new Date(Date.now() - 7200000), // hace 2 horas
      status: 'Retraso',
      actual_taken_datetime: new Date(Date.now() - 3600000), // hace 1 hora (1h de retraso)
    },
  });
  assert(lateLog.status === 'Retraso', 'Log creado como Retraso');
  assert(lateLog.actual_taken_datetime !== null, 'Tiene fecha de toma (aunque retrasada)');

  // ═══════════════════════════════════════════════════════════
  // PASO 10: Escenario — Pausar tratamiento
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 10: ⏸️ Escenario: Pausar tratamiento`);

  await prisma.treatments.update({
    where: { id: treatment.id },
    data: { status: 'Pausado' },
  });

  const pausedTreatment = await prisma.treatments.findUnique({
    where: { id: treatment.id },
  });
  assert(pausedTreatment?.status === 'Pausado', 'Tratamiento pausado');

  // Verificar que findActive NO lo devuelve (filtra por status='Activo')
  const activeTreatment = await prisma.treatments.findFirst({
    where: { patient_id: patient.id, status: 'Activo', deleted_at: null },
  });
  assert(activeTreatment === null, 'findActive no retorna tratamiento pausado');

  // Reactivar
  await prisma.treatments.update({
    where: { id: treatment.id },
    data: { status: 'Activo' },
  });

  // ═══════════════════════════════════════════════════════════
  // PASO 11: Escenario — Finalizar tratamiento
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 11: 🏁 Escenario: Finalizar tratamiento`);

  await prisma.treatments.update({
    where: { id: treatment.id },
    data: { status: 'Finalizado', end_date: new Date() },
  });

  const finishedTreatment = await prisma.treatments.findUnique({
    where: { id: treatment.id },
  });
  assert(finishedTreatment?.status === 'Finalizado', 'Tratamiento finalizado');
  assert(finishedTreatment?.end_date !== null, 'Fecha de fin registrada');

  // ═══════════════════════════════════════════════════════════
  // PASO 12: Escenario — Soft-delete de schedule
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 12: 🗑️ Escenario: Eliminar schedule (soft-delete)`);

  await prisma.schedules.update({
    where: { id: schedule2.id },
    data: { deleted_at: new Date() },
  });

  const deletedSchedule = await prisma.schedules.findFirst({
    where: { id: schedule2.id, deleted_at: null },
  });
  assert(deletedSchedule === null, 'Schedule eliminado (soft-delete)');

  // Verificar que findToday no lo retorna
  const todaySchedules = await prisma.schedules.findMany({
    where: {
      treatment_details: { treatment_id: { in: treatmentIds }, deleted_at: null },
      deleted_at: null,
    },
  });
  assert(todaySchedules.length === 1, `findToday retorna ${todaySchedules.length} schedule(s) (esperado: 1)`);

  // ═══════════════════════════════════════════════════════════
  // PASO 13: Verificar flujo completo de lectura
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${STEP} PASO 13: 🔍 Verificar queries de lectura completas`);

  // findByPatient (treatments)
  const patientTreatments = await prisma.treatments.findMany({
    where: { patient_id: patient.id, deleted_at: null },
    include: {
      treatment_details: {
        where: { deleted_at: null },
        include: { medications: true },
      },
    },
  });
  assert(patientTreatments.length > 0, 'findByPatient retorna tratamientos');
  assert(patientTreatments[0].treatment_details.length > 0, 'Tratamiento incluye details');
  assert(patientTreatments[0].treatment_details[0].medications.name === medication.name, 'Detail incluye medicamento');

  // findRecent (medication-logs)
  const recentLogs = await prisma.medication_logs.findMany({
    where: { schedule_id: { in: scheduleIds }, deleted_at: null },
    orderBy: { scheduled_datetime: 'desc' },
    take: 50,
  });
  assert(recentLogs.length === 3, `findRecent retorna ${recentLogs.length} logs (esperado: 3)`);

  // ═══════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(60));
  console.log('  RESUMEN');
  console.log('='.repeat(60));
  console.log(`\n  Tests pasados: ${testsPassed}`);
  console.log(`  Tests fallidos: ${testsFailed}`);
  console.log(`  Gaps encontrados: ${gapsFound.length}`);

  if (gapsFound.length > 0) {
    console.log('\n  ⚠️  GAPS IDENTIFICADOS:');
    gapsFound.forEach((gap, i) => {
      console.log(`  ${i + 1}. ${gap}`);
    });
  }

  // Cleanup
  console.log('\n  🧹 Limpiando datos de prueba...');
  await prisma.medication_logs.deleteMany({ where: { schedule_id: { in: scheduleIds } } });
  await prisma.schedules.deleteMany({ where: { treatment_detail_id: treatmentDetail.id } });
  await prisma.treatment_details.deleteMany({ where: { treatment_id: treatment.id } });
  await prisma.treatments.deleteMany({ where: { patient_id: patient.id } });
  await prisma.caregiver_patient.deleteMany({ where: { patient_id: patient.id } });
  await prisma.patients.deleteMany({ where: { id: patient.id } });
  await prisma.caregivers.deleteMany({ where: { id: caregiver.id } });
  await prisma.app_profiles.deleteMany({ where: { id: appProfile.id } });
  console.log('  Limpieza completada.\n');
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

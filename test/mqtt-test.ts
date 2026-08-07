import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { DevicesService } from '../src/modules/devices/devices.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PASS = '  ✅';
const FAIL = '  ❌';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`${PASS} ${label}`); testsPassed++; }
  else { console.log(`${FAIL} ${label}`); testsFailed++; }
}

// Mock del ClientProxy MQTT
const mqttLogs: { topic: string; payload: any }[] = [];
const mockMqttClient = {
  emit: (topic: string, payload: any) => { mqttLogs.push({ topic, payload }); },
};

async function main() {
  console.log('='.repeat(60));
  console.log('  TEST: MQTT Handlers — TOMA_CONFIRMADA, SOS, Config');
  console.log('='.repeat(60));

  const devicesService = new DevicesService(prisma as any, mockMqttClient as any);

  // ─── SETUP ───
  console.log('\n🔹 SETUP: Creando datos de prueba...');

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
    data: { first_name: 'MQTT', paternal_last_name: 'Test', birth_date: new Date('1940-01-01'), gender: 'M' },
  });
  await prisma.caregiver_patient.create({
    data: { caregiver_id: caregiver.id, patient_id: patient.id, kinship: 'Otro' },
  });

  const medication = await prisma.medications.findFirst({ where: { deleted_at: null } });
  if (!medication) { console.log(`${FAIL} No hay medicamentos`); return; }

  const treatment = await prisma.treatments.create({
    data: { patient_id: patient.id, start_date: new Date('2026-01-01'), status: 'Activo' },
  });
  const treatmentDetail = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment.id,
      medication_id: medication.id,
      dose_info: '1 tableta',
      frequency_hours: 24,
      first_take_time: new Date('1970-01-01T08:00:00'),
      status: 'En_curso',
    },
  });
  const schedule = await prisma.schedules.create({
    data: { treatment_detail_id: treatmentDetail.id, time_of_day: new Date('1970-01-01T08:00:00') },
  });

  // Crear dispositivo vinculado al paciente
  const device = await prisma.devices.create({
    data: {
      unique_code: 'MQT-001',
      patient_id: patient.id,
      responsible_caregiver_id: caregiver.id,
      is_online: true,
    },
  });

  mqttLogs.length = 0; // Limpiar logs MQTT

  // ═══════════════════════════════════════════════════════════
  // TEST 1: TOMA_CONFIRMADA — log Pendiente → Confirmado
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 1: TOMA_CONFIRMADA → medication_log Confirmado');

  const pendingLog = await prisma.medication_logs.create({
    data: { schedule_id: schedule.id, scheduled_datetime: new Date(), status: 'Pendiente' },
  });

  await devicesService.handleTomaConfirmada('MQT-001');

  const updatedLog = await prisma.medication_logs.findUnique({ where: { id: pendingLog.id } });
  assert(updatedLog?.status === 'Confirmado', 'Log marcado como Confirmado');
  assert(updatedLog?.actual_taken_datetime !== null, 'Fecha de toma registrada');

  // Verificar notificación al cuidador
  const notification = await prisma.notifications.findFirst({
    where: { patient_id: patient.id, title: 'Toma confirmada' },
    orderBy: { created_at: 'desc' },
  });
  assert(notification !== null, 'Notificación creada para el cuidador');
  assert(notification?.type === 'DOSIS_RECORDATORIO', 'Tipo de notificación correcto');

  // ═══════════════════════════════════════════════════════════
  // TEST 2: TOMA_CONFIRMADA sin log Pendiente → warning
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 2: TOMA_CONFIRMADA sin log Pendiente → no crea nada');

  const countBefore = await prisma.medication_logs.count({
    where: { schedule_id: schedule.id, deleted_at: null },
  });

  await devicesService.handleTomaConfirmada('MQT-001');

  const countAfter = await prisma.medication_logs.count({
    where: { schedule_id: schedule.id, deleted_at: null },
  });
  assert(countBefore === countAfter, 'No se creó log adicional');

  // ═══════════════════════════════════════════════════════════
  // TEST 3: SOS → crear sos_event + notificación
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 3: SOS → crea sos_event + notificación SOS_ALERTA');

  await devicesService.handleSosAlert('MQT-001');

  const sosEvent = await prisma.sos_events.findFirst({
    where: { patient_id: patient.id, device_id: device.id },
    orderBy: { created_at: 'desc' },
  });
  assert(sosEvent !== null, 'Evento SOS creado');
  assert(sosEvent?.status === 'Activo', 'Estado del SOS es Activo');

  const sosNotification = await prisma.notifications.findFirst({
    where: { patient_id: patient.id, type: 'SOS_ALERTA' },
    orderBy: { created_at: 'desc' },
  });
  assert(sosNotification !== null, 'Notificación SOS_ALERTA creada');
  assert(sosNotification?.title === 'Alerta SOS', 'Título correcto');

  // ═══════════════════════════════════════════════════════════
  // TEST 4: SOS sin paciente asignado → warning, no crea nada
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 4: SOS sin paciente → no crea evento');

  const deviceNoPatient = await prisma.devices.create({
    data: { unique_code: 'MQT-999', is_online: true },
  });

  const countSosBefore = await prisma.sos_events.count();
  await devicesService.handleSosAlert('MQT-999');
  const countSosAfter = await prisma.sos_events.count();
  assert(countSosBefore === countSosAfter, 'No se creó evento SOS');

  await prisma.devices.delete({ where: { id: deviceNoPatient.id } });

  // ═══════════════════════════════════════════════════════════
  // TEST 5: sendCommand → publica al topic MQTT correcto
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 5: sendCommand → publica MQTT con topic correcto');

  mqttLogs.length = 0;
  await devicesService.sendCommand('MQT-001', 'ALARMA_TOMA');

  assert(mqttLogs.length === 1, 'Se publicó 1 mensaje MQTT');
  assert(mqttLogs[0].topic === 'vitalguard/MQT-001/comando', `Topic correcto: ${mqttLogs[0].topic}`);
  assert(mqttLogs[0].payload.accion === 'ALARMA_TOMA', 'Payload contiene la acción');

  // ═══════════════════════════════════════════════════════════
  // TEST 6: sendCommand con payload extra
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 6: sendCommand con payload extra');

  mqttLogs.length = 0;
  await devicesService.sendCommand('MQT-001', 'CANCELAR_SOS', { eventoId: 1 });

  assert(mqttLogs[0].payload.accion === 'CANCELAR_SOS', 'Acción correcta');
  assert(mqttLogs[0].payload.eventoId === 1, 'Payload extra incluido');

  // ═══════════════════════════════════════════════════════════
  // TEST 7: sendConfigToDevice → publica config con medicamentos
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 7: sendConfigToDevice → publica config completa');

  mqttLogs.length = 0;
  await devicesService.sendConfigToDevice('MQT-001', patient.id);

  assert(mqttLogs.length === 1, 'Se publicó 1 mensaje MQTT');
  assert(mqttLogs[0].topic === 'vitalguard/MQT-001/config', `Topic correcto: ${mqttLogs[0].topic}`);
  assert(mqttLogs[0].payload.proximaToma === '08:00', 'Próxima toma correcta');
  assert(mqttLogs[0].payload.medications.length > 0, 'Medicamentos incluidos');
  assert(mqttLogs[0].payload.medications[0].nombre === medication.name, 'Nombre del medicamento correcto');

  // ═══════════════════════════════════════════════════════════
  // TEST 8: TOMA_CONFIRMADA crea notificación con patient_id
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔹 TEST 8: Notificación de TOMA incluye patient_id');

  const log8 = await prisma.medication_logs.create({
    data: { schedule_id: schedule.id, scheduled_datetime: new Date(), status: 'Pendiente' },
  });

  await devicesService.handleTomaConfirmada('MQT-001');

  const notif8 = await prisma.notifications.findFirst({
    where: { patient_id: patient.id, title: 'Toma confirmada' },
    orderBy: { created_at: 'desc' },
  });
  assert(notif8?.patient_id === patient.id, 'Notificación tiene patient_id correcto');

  // ═══════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(60));
  console.log('  RESUMEN');
  console.log('='.repeat(60));
  console.log(`\n  Tests pasados: ${testsPassed}`);
  console.log(`  Tests fallidos: ${testsFailed}`);

  // Cleanup
  console.log('\n  🧹 Limpiando...');
  await prisma.medication_logs.deleteMany({ where: { schedule_id: schedule.id } });
  await prisma.schedules.delete({ where: { id: schedule.id } });
  await prisma.treatment_details.delete({ where: { id: treatmentDetail.id } });
  await prisma.treatments.delete({ where: { id: treatment.id } });
  await prisma.sos_events.deleteMany({ where: { patient_id: patient.id } });
  await prisma.notifications.deleteMany({ where: { patient_id: patient.id } });
  await prisma.devices.deleteMany({ where: { unique_code: { startsWith: 'MQT-' } } });
  await prisma.caregiver_patient.deleteMany({ where: { patient_id: patient.id } });
  await prisma.patients.delete({ where: { id: patient.id } });
  await prisma.caregivers.delete({ where: { id: caregiver.id } });
  await prisma.app_profiles.delete({ where: { id: appProfile.id } });
  console.log('  Limpieza completada.\n');
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());

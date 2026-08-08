import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Clean existing data in reverse dependency order
  await prisma.notifications.deleteMany();
  await prisma.voice_messages.deleteMany();
  await prisma.medication_logs.deleteMany();
  await prisma.schedules.deleteMany();
  await prisma.treatment_details.deleteMany();
  await prisma.treatments.deleteMany();
  await prisma.device_compartments.deleteMany();
  await prisma.devices.deleteMany();
  await prisma.doctor_patient.deleteMany();
  await prisma.doctors.deleteMany();
  await prisma.caregiver_patient.deleteMany();
  await prisma.caregivers.deleteMany();
  await prisma.patients.deleteMany();
  await prisma.app_profiles.deleteMany();
  await prisma.medications.deleteMany();
  await prisma.roles.deleteMany();

  // 1. Roles
  const rolePatient = await prisma.roles.create({
    data: { name: 'PATIENT', app_name: 'MOBILE', is_system: true },
  });
  const roleCaregiver = await prisma.roles.create({
    data: { name: 'CAREGIVER', app_name: 'MOBILE', is_system: true },
  });
  const roleDoctor = await prisma.roles.create({
    data: { name: 'DOCTOR', app_name: 'MOBILE', is_system: true },
  });
  const roleAdmin = await prisma.roles.create({
    data: { name: 'ADMIN_SUPPORT', app_name: 'WEB', is_system: true },
  });

  // 2. App Profiles (vital IDs simulados)
  const profilePatient = await prisma.app_profiles.create({
    data: { vital_id: 'a0000000-0000-0000-0000-000000000001', role_id: rolePatient.id, is_active: true },
  });
  const profileCaregiver = await prisma.app_profiles.create({
    data: { vital_id: 'a0000000-0000-0000-0000-000000000002', role_id: roleCaregiver.id, is_active: true },
  });
  const profileDoctor = await prisma.app_profiles.create({
    data: { vital_id: 'a0000000-0000-0000-0000-000000000003', role_id: roleDoctor.id, is_active: true },
  });

  // 3. Patients
  const patient1 = await prisma.patients.create({
    data: {
      first_name: 'María',
      paternal_last_name: 'García',
      maternal_last_name: 'López',
      birth_date: new Date('1945-03-12'),
      gender: 'F',
      phone: '5551234567',
      address: 'Calle Olmo #123, Colonia Centro',
      blood_type: 'O_POSITIVE',
      medical_notes: 'Alergia a la penicilina. Hipertensión controlada con Losartán.',
    },
  });

  const patient2 = await prisma.patients.create({
    data: {
      first_name: 'José',
      paternal_last_name: 'Martínez',
      maternal_last_name: 'Hernández',
      birth_date: new Date('1938-07-25'),
      gender: 'M',
      phone: '5559876543',
      address: 'Av. Reforma #456, Colonia Juárez',
      blood_type: 'A_POSITIVE',
      medical_notes: 'Diabetes tipo 2. Artritis reumatoide.',
    },
  });

  const patient3 = await prisma.patients.create({
    data: {
      first_name: 'Carmen',
      paternal_last_name: 'Ramírez',
      maternal_last_name: null,
      birth_date: new Date('1950-11-03'),
      gender: 'F',
      phone: '5554567890',
      blood_type: 'B_POSITIVE',
    },
  });

  // 4. Caregivers
  const caregiver1 = await prisma.caregivers.create({
    data: {
      app_profile_id: profileCaregiver.id,
      emergency_call_priority: 1,
    },
  });

  // 5. Caregiver-Patient relationships
  await prisma.caregiver_patient.create({
    data: { caregiver_id: caregiver1.id, patient_id: patient1.id, kinship: 'Hijo_a' },
  });
  await prisma.caregiver_patient.create({
    data: { caregiver_id: caregiver1.id, patient_id: patient2.id, kinship: 'Hijo_a' },
  });

  // 6. Doctor
  const doctor1 = await prisma.doctors.create({
    data: {
      app_profile_id: profileDoctor.id,
      specialty: 'Geriatría',
      medical_license: 'LIC-12345',
    },
  });

  await prisma.doctor_patient.create({
    data: { doctor_id: doctor1.id, patient_id: patient1.id },
  });
  await prisma.doctor_patient.create({
    data: { doctor_id: doctor1.id, patient_id: patient2.id },
  });

  // 7. Medications
  const meds = await Promise.all([
    prisma.medications.create({ data: { name: 'Losartán', presentation: '50 mg tabletas' } }),
    prisma.medications.create({ data: { name: 'Metformina', presentation: '850 mg tabletas' } }),
    prisma.medications.create({ data: { name: 'Atorvastatina', presentation: '20 mg tabletas' } }),
    prisma.medications.create({ data: { name: 'Omeprazol', presentation: '20 mg cápsulas' } }),
    prisma.medications.create({ data: { name: 'Paracetamol', presentation: '500 mg tabletas' } }),
    prisma.medications.create({ data: { name: 'Enap', presentation: '10 mg tabletas' } }),
    prisma.medications.create({ data: { name: 'Aspirina', presentation: '100 mg tabletas' } }),
    prisma.medications.create({ data: { name: 'Vitamina D', presentation: '400 UI cápsulas' } }),
  ]);

  // 8. Treatments
  const treatment1 = await prisma.treatments.create({
    data: {
      patient_id: patient1.id,
      app_profile_id: profileCaregiver.id,
      start_date: new Date('2026-06-01'),
      end_date: new Date('2026-12-31'),
      status: 'Activo',
    },
  });

  const treatment2 = await prisma.treatments.create({
    data: {
      patient_id: patient2.id,
      app_profile_id: profileCaregiver.id,
      start_date: new Date('2026-05-15'),
      status: 'Activo',
    },
  });

  // 9. Treatment Details
  const detail1 = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment1.id,
      medication_id: meds[0].id, // Losartán
      dose_info: '1 tableta',
      frequency_hours: 24,
      first_take_time: new Date('2026-01-01T08:00:00'),
      status: 'En_curso',
      compartment_number: 1,
      is_external: false,
    },
  });

  const detail2 = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment1.id,
      medication_id: meds[3].id, // Omeprazol
      dose_info: '1 cápsula',
      frequency_hours: 24,
      first_take_time: new Date('2026-01-01T07:00:00'),
      status: 'En_curso',
      compartment_number: 2,
      is_external: false,
    },
  });

  const detail3 = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment2.id,
      medication_id: meds[1].id, // Metformina
      dose_info: '1 tableta',
      frequency_hours: 12,
      first_take_time: new Date('2026-01-01T08:00:00'),
      status: 'En_curso',
      compartment_number: 1,
      is_external: false,
    },
  });

  const detail4 = await prisma.treatment_details.create({
    data: {
      treatment_id: treatment2.id,
      medication_id: meds[2].id, // Atorvastatina
      dose_info: '1 tableta',
      frequency_hours: 24,
      first_take_time: new Date('2026-01-01T21:00:00'),
      status: 'En_curso',
      compartment_number: 2,
      is_external: false,
    },
  });

  // 10. Schedules
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const schedule1 = await prisma.schedules.create({
    data: { treatment_detail_id: detail1.id, time_of_day: new Date('2026-01-01T08:00:00') },
  });
  const schedule2 = await prisma.schedules.create({
    data: { treatment_detail_id: detail2.id, time_of_day: new Date('2026-01-01T07:00:00') },
  });
  const schedule3 = await prisma.schedules.create({
    data: { treatment_detail_id: detail3.id, time_of_day: new Date('2026-01-01T08:00:00') },
  });
  const schedule4 = await prisma.schedules.create({
    data: { treatment_detail_id: detail3.id, time_of_day: new Date('2026-01-01T20:00:00') },
  });
  const schedule5 = await prisma.schedules.create({
    data: { treatment_detail_id: detail4.id, time_of_day: new Date('2026-01-01T21:00:00') },
  });

  // 11. Medication Logs (hoy)
  const scheduledToday1 = new Date(today);
  scheduledToday1.setHours(8, 0, 0, 0);
  const scheduledToday2 = new Date(today);
  scheduledToday2.setHours(7, 0, 0, 0);
  const scheduledToday3 = new Date(today);
  scheduledToday3.setHours(8, 0, 0, 0);
  const scheduledToday4 = new Date(today);
  scheduledToday4.setHours(20, 0, 0, 0);
  const scheduledToday5 = new Date(today);
  scheduledToday5.setHours(21, 0, 0, 0);

  const takenToday1 = new Date(scheduledToday1);
  takenToday1.setMinutes(5);
  const takenToday2 = new Date(scheduledToday2);
  takenToday2.setMinutes(3);

  await prisma.medication_logs.create({
    data: {
      schedule_id: schedule1.id,
      scheduled_datetime: scheduledToday1,
      actual_taken_datetime: takenToday1,
      status: 'Confirmado',
      voice_confirmed: true,
    },
  });
  await prisma.medication_logs.create({
    data: {
      schedule_id: schedule2.id,
      scheduled_datetime: scheduledToday2,
      actual_taken_datetime: takenToday2,
      status: 'Confirmado',
      voice_confirmed: true,
    },
  });
  await prisma.medication_logs.create({
    data: {
      schedule_id: schedule3.id,
      scheduled_datetime: scheduledToday3,
      status: 'Pendiente',
    },
  });
  await prisma.medication_logs.create({
    data: {
      schedule_id: schedule4.id,
      scheduled_datetime: scheduledToday4,
      status: 'Pendiente',
    },
  });
  await prisma.medication_logs.create({
    data: {
      schedule_id: schedule5.id,
      scheduled_datetime: scheduledToday5,
      status: 'Pendiente',
    },
  });

  // Logs de días anteriores para adherencia
  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - daysAgo);
    const morning = new Date(pastDate);
    morning.setHours(8, 0, 0, 0);
    const night = new Date(pastDate);
    night.setHours(20, 0, 0, 0);

    const takenMorning = new Date(morning);
    takenMorning.setMinutes(Math.floor(Math.random() * 15));

    await prisma.medication_logs.create({
      data: {
        schedule_id: schedule1.id,
        scheduled_datetime: morning,
        actual_taken_datetime: daysAgo > 1 ? takenMorning : null,
        status: daysAgo > 1 ? 'Confirmado' : 'Omitida',
        voice_confirmed: daysAgo > 1,
      },
    });
    await prisma.medication_logs.create({
      data: {
        schedule_id: schedule3.id,
        scheduled_datetime: morning,
        actual_taken_datetime: daysAgo > 2 ? takenMorning : null,
        status: daysAgo > 2 ? 'Confirmado' : 'Retraso',
        voice_confirmed: daysAgo > 2,
      },
    });
    await prisma.medication_logs.create({
      data: {
        schedule_id: schedule4.id,
        scheduled_datetime: night,
        actual_taken_datetime: daysAgo > 1 ? night : null,
        status: daysAgo > 1 ? 'Confirmado' : 'Pendiente',
        voice_confirmed: daysAgo > 1,
      },
    });
  }

  // 12. Devices
  const device1 = await prisma.devices.create({
    data: {
      unique_code: 'VG-0001',
      patient_id: patient1.id,
      responsible_caregiver_id: caregiver1.id,
      is_online: true,
      last_sync_at: new Date(),
      firmware_version: '2.1.0',
    },
  });

  const device2 = await prisma.devices.create({
    data: {
      unique_code: 'VG-0002',
      patient_id: patient2.id,
      responsible_caregiver_id: caregiver1.id,
      is_online: false,
      last_sync_at: new Date(Date.now() - 3600000),
      firmware_version: '2.0.5',
    },
  });

  await prisma.device_compartments.create({ data: { device_id: device1.id, compartment_number: 1, status: 'closed' } });
  await prisma.device_compartments.create({ data: { device_id: device1.id, compartment_number: 2, status: 'closed' } });
  await prisma.device_compartments.create({ data: { device_id: device1.id, compartment_number: 3, status: 'closed' } });
  await prisma.device_compartments.create({ data: { device_id: device2.id, compartment_number: 1, status: 'open' } });
  await prisma.device_compartments.create({ data: { device_id: device2.id, compartment_number: 2, status: 'closed' } });

  // 13. SOS Events
  await prisma.sos_events.create({
    data: {
      patient_id: patient1.id,
      device_id: device1.id,
      status: 'Atendido',
      resolving_caregiver_id: caregiver1.id,
    },
  });
  await prisma.sos_events.create({
    data: {
      patient_id: patient1.id,
      device_id: device1.id,
      status: 'Falsa_Alarma',
    },
  });

  // 14. Voice Messages
  await prisma.voice_messages.create({
    data: {
      sender_caregiver_id: caregiver1.id,
      patient_id: patient1.id,
      audio_file_path: '/audio/msg_001.mp3',
      is_played: true,
    },
  });
  await prisma.voice_messages.create({
    data: {
      sender_caregiver_id: caregiver1.id,
      patient_id: patient2.id,
      audio_file_path: '/audio/msg_002.mp3',
      is_played: false,
    },
  });

  // 15. Notifications
  await prisma.notifications.create({
    data: {
      app_profile_id: profileCaregiver.id,
      patient_id: patient1.id,
      title: 'Dosis confirmada',
      message: 'María tomó su Losartán de las 8:00',
      type: 'DOSIS_RECORDATORIO',
      is_read: false,
    },
  });
  await prisma.notifications.create({
    data: {
      app_profile_id: profileCaregiver.id,
      patient_id: patient2.id,
      title: 'Recordatorio',
      message: 'José tiene dosis pendiente de Metformina',
      type: 'DOSIS_RECORDATORIO',
      is_read: false,
    },
  });

  console.log('Seed completed successfully');
  console.log(`  Patients: ${patient1.first_name}, ${patient2.first_name}, ${patient3.first_name}`);
  console.log(`  Caregivers: 1`);
  console.log(`  Doctors: ${doctor1.specialty}`);
  console.log(`  Medications: ${meds.length}`);
  console.log(`  Treatments: 2 active`);
  console.log(`  Schedules: 5`);
  console.log(`  Devices: 2`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

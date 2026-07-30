-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('MEDICAMENTO_SOLICITUD', 'DOSIS_RECORDATORIO', 'SOS_ALERTA', 'SISTEMA');

-- CreateEnum
CREATE TYPE "app_name" AS ENUM ('MOBILE', 'WEB', 'IOT');

-- CreateEnum
CREATE TYPE "blood_type" AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');

-- CreateEnum
CREATE TYPE "compartment_status" AS ENUM ('closed', 'open');

-- CreateEnum
CREATE TYPE "gender_type" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "kinship_type" AS ENUM ('Madre', 'Padre', 'Hijo/a', 'Abuelo/a', 'Esposo/a', 'Cuidador', 'Otro');

-- CreateEnum
CREATE TYPE "log_status" AS ENUM ('Pendiente', 'Confirmado', 'Retraso', 'Omitida');

-- CreateEnum
CREATE TYPE "medication_status" AS ENUM ('En curso', 'Finalizado');

-- CreateEnum
CREATE TYPE "sos_status" AS ENUM ('Activo', 'Atendido', 'Falsa Alarma');

-- CreateEnum
CREATE TYPE "treatment_status" AS ENUM ('Activo', 'Pausado', 'Finalizado');

-- CreateTable
CREATE TABLE "app_profiles" (
    "id" SERIAL NOT NULL,
    "vital_id" UUID NOT NULL,
    "role_id" INTEGER NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "app_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_patient" (
    "caregiver_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "kinship" "kinship_type",
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "caregiver_patient_pkey" PRIMARY KEY ("caregiver_id","patient_id")
);

-- CreateTable
CREATE TABLE "caregivers" (
    "id" SERIAL NOT NULL,
    "app_profile_id" INTEGER NOT NULL,
    "emergency_call_priority" SMALLINT DEFAULT 1,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "caregivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_compartments" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "compartment_number" SMALLINT NOT NULL,
    "status" "compartment_status" DEFAULT 'closed',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "device_compartments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "unique_code" VARCHAR(7) NOT NULL,
    "patient_id" INTEGER,
    "responsible_caregiver_id" INTEGER,
    "is_online" BOOLEAN DEFAULT false,
    "last_sync_at" TIMESTAMP(6),
    "firmware_version" VARCHAR(20),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_patient" (
    "doctor_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "doctor_patient_pkey" PRIMARY KEY ("doctor_id","patient_id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" SERIAL NOT NULL,
    "app_profile_id" INTEGER NOT NULL,
    "specialty" VARCHAR(50) NOT NULL,
    "medical_license" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_logs" (
    "id" SERIAL NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "scheduled_datetime" TIMESTAMP(6) NOT NULL,
    "actual_taken_datetime" TIMESTAMP(6),
    "status" "log_status" DEFAULT 'Pendiente',
    "voice_confirmed" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "medication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "presentation" VARCHAR(50),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR(50) NOT NULL,
    "paternal_last_name" VARCHAR(25) NOT NULL,
    "maternal_last_name" VARCHAR(25),
    "birth_date" DATE NOT NULL,
    "gender" "gender_type" NOT NULL,
    "phone" VARCHAR(10),
    "address" VARCHAR(100),
    "blood_type" "blood_type",
    "medical_notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "app_name" "app_name" NOT NULL,
    "is_system" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "treatment_detail_id" INTEGER NOT NULL,
    "time_of_day" TIME(6) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_events" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "device_id" INTEGER,
    "status" "sos_status" DEFAULT 'Activo',
    "resolving_caregiver_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_details" (
    "id" SERIAL NOT NULL,
    "treatment_id" INTEGER NOT NULL,
    "medication_id" INTEGER NOT NULL,
    "dose_info" VARCHAR(50),
    "frequency_hours" SMALLINT DEFAULT 1,
    "first_take_time" TIME(6) NOT NULL,
    "end_date" DATE,
    "status" "medication_status" DEFAULT 'En curso',
    "compartment_number" SMALLINT,
    "is_external" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "treatment_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatments" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "app_profile_id" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "treatment_status" DEFAULT 'Activo',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_messages" (
    "id" SERIAL NOT NULL,
    "sender_caregiver_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "audio_file_path" VARCHAR(255) NOT NULL,
    "is_played" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "app_profile_id" INTEGER NOT NULL,
    "patient_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "message" VARCHAR(255) NOT NULL,
    "type" "notification_type" NOT NULL DEFAULT 'SISTEMA',
    "is_read" BOOLEAN DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_app_profiles_active" ON "app_profiles"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_app_profiles_role" ON "app_profiles"("role_id");

-- CreateIndex
CREATE INDEX "idx_app_profiles_vital_id" ON "app_profiles"("vital_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_profiles_vital_id_role_id_key" ON "app_profiles"("vital_id", "role_id");

-- CreateIndex
CREATE INDEX "idx_caregiver_patient_active" ON "caregiver_patient"("caregiver_id", "patient_id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_caregiver_patient_caregiver" ON "caregiver_patient"("caregiver_id");

-- CreateIndex
CREATE INDEX "idx_caregiver_patient_patient" ON "caregiver_patient"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "caregivers_app_profile_id_key" ON "caregivers"("app_profile_id");

-- CreateIndex
CREATE INDEX "idx_caregivers_active" ON "caregivers"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_caregivers_app_profile" ON "caregivers"("app_profile_id");

-- CreateIndex
CREATE INDEX "idx_device_compartments_active" ON "device_compartments"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_device_compartments_device" ON "device_compartments"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_compartments_device_id_compartment_number_key" ON "device_compartments"("device_id", "compartment_number");

-- CreateIndex
CREATE UNIQUE INDEX "idx_unique_active_compartment" ON "device_compartments"("device_id", "compartment_number") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "devices_unique_code_key" ON "devices"("unique_code");

-- CreateIndex
CREATE UNIQUE INDEX "devices_patient_id_key" ON "devices"("patient_id");

-- CreateIndex
CREATE INDEX "idx_devices_active" ON "devices"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_devices_caregiver" ON "devices"("responsible_caregiver_id");

-- CreateIndex
CREATE INDEX "idx_devices_patient" ON "devices"("patient_id");

-- CreateIndex
CREATE INDEX "idx_doctor_patient_active" ON "doctor_patient"("doctor_id", "patient_id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_doctor_patient_doctor" ON "doctor_patient"("doctor_id");

-- CreateIndex
CREATE INDEX "idx_doctor_patient_patient" ON "doctor_patient"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_app_profile_id_key" ON "doctors"("app_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_medical_license_key" ON "doctors"("medical_license");

-- CreateIndex
CREATE INDEX "idx_doctors_active" ON "doctors"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_doctors_app_profile" ON "doctors"("app_profile_id");

-- CreateIndex
CREATE INDEX "idx_medication_logs_active" ON "medication_logs"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_medication_logs_datetime" ON "medication_logs"("scheduled_datetime");

-- CreateIndex
CREATE INDEX "idx_medication_logs_schedule" ON "medication_logs"("schedule_id");

-- CreateIndex
CREATE INDEX "idx_medication_logs_status" ON "medication_logs"("status");

-- CreateIndex
CREATE INDEX "idx_medications_active" ON "medications"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_patients_active" ON "patients"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "idx_roles_active" ON "roles"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_roles_app_name" ON "roles"("app_name");

-- CreateIndex
CREATE INDEX "idx_schedules_active" ON "schedules"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_schedules_detail" ON "schedules"("treatment_detail_id");

-- CreateIndex
CREATE INDEX "idx_sos_events_caregiver" ON "sos_events"("resolving_caregiver_id");

-- CreateIndex
CREATE INDEX "idx_sos_events_device" ON "sos_events"("device_id");

-- CreateIndex
CREATE INDEX "idx_sos_events_patient" ON "sos_events"("patient_id");

-- CreateIndex
CREATE INDEX "idx_sos_events_status" ON "sos_events"("status");

-- CreateIndex
CREATE INDEX "idx_treatment_details_active" ON "treatment_details"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_treatment_details_medication" ON "treatment_details"("medication_id");

-- CreateIndex
CREATE INDEX "idx_treatment_details_treatment" ON "treatment_details"("treatment_id");

-- CreateIndex
CREATE INDEX "idx_treatments_active" ON "treatments"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_treatments_app_profile" ON "treatments"("app_profile_id");

-- CreateIndex
CREATE INDEX "idx_treatments_patient" ON "treatments"("patient_id");

-- CreateIndex
CREATE INDEX "idx_voice_messages_patient" ON "voice_messages"("patient_id");

-- CreateIndex
CREATE INDEX "idx_voice_messages_sender" ON "voice_messages"("sender_caregiver_id");

-- CreateIndex
CREATE INDEX "idx_notifications_profile" ON "notifications"("app_profile_id");

-- CreateIndex
CREATE INDEX "idx_notifications_patient" ON "notifications"("patient_id");

-- CreateIndex
CREATE INDEX "idx_notifications_unread" ON "notifications"("is_read");

-- AddForeignKey
ALTER TABLE "app_profiles" ADD CONSTRAINT "app_profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caregiver_patient" ADD CONSTRAINT "caregiver_patient_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "caregivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caregiver_patient" ADD CONSTRAINT "caregiver_patient_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_app_profile_id_fkey" FOREIGN KEY ("app_profile_id") REFERENCES "app_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "device_compartments" ADD CONSTRAINT "device_compartments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_responsible_caregiver_id_fkey" FOREIGN KEY ("responsible_caregiver_id") REFERENCES "caregivers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doctor_patient" ADD CONSTRAINT "doctor_patient_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doctor_patient" ADD CONSTRAINT "doctor_patient_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_app_profile_id_fkey" FOREIGN KEY ("app_profile_id") REFERENCES "app_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_treatment_detail_id_fkey" FOREIGN KEY ("treatment_detail_id") REFERENCES "treatment_details"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_resolving_caregiver_id_fkey" FOREIGN KEY ("resolving_caregiver_id") REFERENCES "caregivers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "treatment_details" ADD CONSTRAINT "treatment_details_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "treatment_details" ADD CONSTRAINT "treatment_details_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_app_profile_id_fkey" FOREIGN KEY ("app_profile_id") REFERENCES "app_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_messages" ADD CONSTRAINT "voice_messages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_messages" ADD CONSTRAINT "voice_messages_sender_caregiver_id_fkey" FOREIGN KEY ("sender_caregiver_id") REFERENCES "caregivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_app_profile_id_fkey" FOREIGN KEY ("app_profile_id") REFERENCES "app_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

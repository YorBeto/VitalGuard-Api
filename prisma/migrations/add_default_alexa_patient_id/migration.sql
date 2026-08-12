-- Migration: add_default_alexa_patient_id
-- Añade la columna default_alexa_patient_id a app_profiles
-- (scalar Int, sin FK) para el caso B7: cuidador multi-paciente con paciente por defecto en Alexa.
-- El índice coincide con @@index([default_alexa_patient_id], map:"idx_app_profiles_default_alexa_patient") del schema.

ALTER TABLE "app_profiles" ADD COLUMN "default_alexa_patient_id" INTEGER;

CREATE INDEX "idx_app_profiles_default_alexa_patient"
ON "app_profiles" ("default_alexa_patient_id");
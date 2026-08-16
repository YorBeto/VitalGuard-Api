-- Migration: add_soft_delete_columns
-- Añade las columnas soft-delete (deleted_at) que faltan en el schema frente a la migración inicial 0_init.
-- sos_events y voice_messages fueron creadas sin deleted_at en 0_init, pero el schema las define con esa columna.

ALTER TABLE "sos_events" ADD COLUMN "deleted_at" TIMESTAMP(6);
ALTER TABLE "voice_messages" ADD COLUMN "deleted_at" TIMESTAMP(6);
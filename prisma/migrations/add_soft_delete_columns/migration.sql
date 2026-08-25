-- Migration: add_soft_delete_columns
-- Añade las columnas soft-delete (deleted_at) que faltan en el schema frente a la migración inicial 0_init.
-- sos_events y voice_messages fueron creadas sin deleted_at en 0_init, pero el schema las define con esa columna.
-- NOTA: la migración 20260813233515 ya agrega estas mismas columnas; se usa IF NOT EXISTS
-- para que esta migración sea segura de aplicar sin importar si esa otra ya corrió antes.

ALTER TABLE "sos_events" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(6);
ALTER TABLE "voice_messages" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(6);
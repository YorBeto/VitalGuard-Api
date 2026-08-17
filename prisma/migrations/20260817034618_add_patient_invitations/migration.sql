-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "invitee_role" AS ENUM ('CAREGIVER', 'DOCTOR');

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'INVITACION_CUIDADOR';

-- CreateTable
CREATE TABLE "patient_invitations" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "invited_by_caregiver_id" INTEGER NOT NULL,
    "invitee_vital_id" UUID,
    "invitee_email" VARCHAR(254),
    "invitee_role" "invitee_role" NOT NULL DEFAULT 'CAREGIVER',
    "kinship" "kinship_type",
    "status" "invitation_status" NOT NULL DEFAULT 'PENDIENTE',
    "token" TEXT,
    "expires_at" TIMESTAMP(6),
    "responded_at" TIMESTAMP(6),
    "email_delivered" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "patient_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_invitations_token_key" ON "patient_invitations"("token");

-- CreateIndex
CREATE INDEX "idx_invitations_active" ON "patient_invitations"("id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_invitations_patient" ON "patient_invitations"("patient_id");

-- CreateIndex
CREATE INDEX "idx_invitations_sender" ON "patient_invitations"("invited_by_caregiver_id");

-- CreateIndex
CREATE INDEX "idx_invitations_invitee" ON "patient_invitations"("invitee_vital_id");

-- CreateIndex
CREATE INDEX "idx_invitations_status" ON "patient_invitations"("status");

-- AddForeignKey
ALTER TABLE "patient_invitations" ADD CONSTRAINT "patient_invitations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "patient_invitations" ADD CONSTRAINT "patient_invitations_invited_by_caregiver_id_fkey" FOREIGN KEY ("invited_by_caregiver_id") REFERENCES "caregivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

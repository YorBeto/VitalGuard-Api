-- CreateTable
CREATE TABLE "device_tokens" (
    "id" SERIAL NOT NULL,
    "app_profile_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(20),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_device_tokens_profile" ON "device_tokens"("app_profile_id");

-- CreateIndex
CREATE INDEX "idx_device_tokens_token" ON "device_tokens"("token");

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_app_profile_id_fkey" FOREIGN KEY ("app_profile_id") REFERENCES "app_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

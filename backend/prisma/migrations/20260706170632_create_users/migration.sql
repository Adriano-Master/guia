-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('ADMIN', 'MODERADOR', 'PROFESSOR', 'ALUNO');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ATIVO', 'INATIVO', 'PENDENTE');

-- CreateEnum
CREATE TYPE "origem" AS ENUM ('PROPRIO', 'HOTMART');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "senha_hash" TEXT,
    "role" "role" NOT NULL,
    "status" "user_status" NOT NULL,
    "origem" "origem" NOT NULL,
    "ultimo_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

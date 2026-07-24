-- CreateEnum
CREATE TYPE "matricula_status" AS ENUM ('ATIVA', 'INATIVA');

-- CreateTable
CREATE TABLE "turmas" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "professor_id" UUID NOT NULL,
    "codigo_convite" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "turmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matriculas" (
    "id" UUID NOT NULL,
    "turma_id" UUID NOT NULL,
    "aluno_id" UUID NOT NULL,
    "status" "matricula_status" NOT NULL DEFAULT 'ATIVA',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "matriculas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turma_planos" (
    "id" UUID NOT NULL,
    "turma_id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "turma_planos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "turmas_codigo_convite_key" ON "turmas"("codigo_convite");

-- CreateIndex
CREATE INDEX "turmas_professor_id_idx" ON "turmas"("professor_id");

-- CreateIndex
CREATE INDEX "matriculas_aluno_id_idx" ON "matriculas"("aluno_id");

-- CreateIndex
CREATE UNIQUE INDEX "matriculas_turma_id_aluno_id_key" ON "matriculas"("turma_id", "aluno_id");

-- CreateIndex
CREATE UNIQUE INDEX "turma_planos_turma_id_plano_id_key" ON "turma_planos"("turma_id", "plano_id");

-- AddForeignKey
ALTER TABLE "turmas" ADD CONSTRAINT "turmas_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turma_planos" ADD CONSTRAINT "turma_planos_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turma_planos" ADD CONSTRAINT "turma_planos_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "sessao_origem" AS ENUM ('CRONOMETRO', 'MANUAL');

-- CreateTable
CREATE TABLE "sessoes_estudo" (
    "id" UUID NOT NULL,
    "aluno_id" UUID NOT NULL,
    "disciplina_id" UUID NOT NULL,
    "subtema_id" UUID,
    "bloco_id" UUID,
    "origem" "sessao_origem" NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fim" TIMESTAMPTZ(6),
    "duracao_min" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessoes_estudo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessoes_estudo_aluno_id_inicio_idx" ON "sessoes_estudo"("aluno_id", "inicio");

-- AddForeignKey
ALTER TABLE "sessoes_estudo" ADD CONSTRAINT "sessoes_estudo_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_estudo" ADD CONSTRAINT "sessoes_estudo_disciplina_id_fkey" FOREIGN KEY ("disciplina_id") REFERENCES "disciplinas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_estudo" ADD CONSTRAINT "sessoes_estudo_subtema_id_fkey" FOREIGN KEY ("subtema_id") REFERENCES "subtemas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_estudo" ADD CONSTRAINT "sessoes_estudo_bloco_id_fkey" FOREIGN KEY ("bloco_id") REFERENCES "blocos_cronograma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariante RN-1 "no máximo 1 cronômetro em andamento por aluno" (D-2)
-- garantida no banco por índice único parcial (não representável no schema
-- Prisma; ver comentário no model SessaoEstudo). Segunda linha de defesa
-- contra corridas de start, além do SELECT ... FOR UPDATE transacional (CB-5).
CREATE UNIQUE INDEX "sessoes_estudo_aluno_id_cronometro_ativo_unique"
  ON "sessoes_estudo" ("aluno_id")
  WHERE "origem" = 'CRONOMETRO' AND "fim" IS NULL AND "deleted_at" IS NULL;

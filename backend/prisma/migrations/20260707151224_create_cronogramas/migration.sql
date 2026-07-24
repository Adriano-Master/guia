-- CreateEnum
CREATE TYPE "bloco_status" AS ENUM ('PLANEJADO', 'CONCLUIDO', 'PULADO');

-- CreateTable
CREATE TABLE "cronogramas" (
    "id" UUID NOT NULL,
    "aluno_id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "dias_semana" INTEGER[],
    "janelas" JSONB NOT NULL,
    "horas_semana_total" DECIMAL(5,2) NOT NULL,
    "granularidade_min" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "gerado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "cronogramas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocos_cronograma" (
    "id" UUID NOT NULL,
    "cronograma_id" UUID NOT NULL,
    "disciplina_id" UUID NOT NULL,
    "subtema_id" UUID,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fim" TIMESTAMPTZ(6) NOT NULL,
    "duracao_min" INTEGER NOT NULL,
    "status" "bloco_status" NOT NULL DEFAULT 'PLANEJADO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "blocos_cronograma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progresso_subtemas" (
    "id" UUID NOT NULL,
    "aluno_id" UUID NOT NULL,
    "subtema_id" UUID NOT NULL,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "concluido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "progresso_subtemas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cronogramas_aluno_id_ativo_idx" ON "cronogramas"("aluno_id", "ativo");

-- CreateIndex
CREATE INDEX "blocos_cronograma_cronograma_id_inicio_idx" ON "blocos_cronograma"("cronograma_id", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "progresso_subtemas_aluno_id_subtema_id_key" ON "progresso_subtemas"("aluno_id", "subtema_id");

-- AddForeignKey
ALTER TABLE "cronogramas" ADD CONSTRAINT "cronogramas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cronogramas" ADD CONSTRAINT "cronogramas_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocos_cronograma" ADD CONSTRAINT "blocos_cronograma_cronograma_id_fkey" FOREIGN KEY ("cronograma_id") REFERENCES "cronogramas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocos_cronograma" ADD CONSTRAINT "blocos_cronograma_disciplina_id_fkey" FOREIGN KEY ("disciplina_id") REFERENCES "disciplinas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocos_cronograma" ADD CONSTRAINT "blocos_cronograma_subtema_id_fkey" FOREIGN KEY ("subtema_id") REFERENCES "subtemas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progresso_subtemas" ADD CONSTRAINT "progresso_subtemas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progresso_subtemas" ADD CONSTRAINT "progresso_subtemas_subtema_id_fkey" FOREIGN KEY ("subtema_id") REFERENCES "subtemas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "registro_questoes" (
    "id" UUID NOT NULL,
    "aluno_id" UUID NOT NULL,
    "tema_id" UUID NOT NULL,
    "subtema_id" UUID,
    "data" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "erros" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "registro_questoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registro_questoes_aluno_id_tema_id_data_idx" ON "registro_questoes"("aluno_id", "tema_id", "data");

-- AddForeignKey
ALTER TABLE "registro_questoes" ADD CONSTRAINT "registro_questoes_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_questoes" ADD CONSTRAINT "registro_questoes_tema_id_fkey" FOREIGN KEY ("tema_id") REFERENCES "temas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_questoes" ADD CONSTRAINT "registro_questoes_subtema_id_fkey" FOREIGN KEY ("subtema_id") REFERENCES "subtemas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "pontuacoes_aluno" (
    "id" UUID NOT NULL,
    "aluno_id" UUID NOT NULL,
    "pontos" INTEGER NOT NULL,
    "subtemas_concluidos" INTEGER NOT NULL,
    "horas_estudadas" DECIMAL(10,2) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pontuacoes_aluno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pontuacoes_aluno_aluno_id_key" ON "pontuacoes_aluno"("aluno_id");

-- AddForeignKey
ALTER TABLE "pontuacoes_aluno" ADD CONSTRAINT "pontuacoes_aluno_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

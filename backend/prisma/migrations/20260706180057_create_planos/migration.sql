-- CreateEnum
CREATE TYPE "plano_tipo" AS ENUM ('OFICIAL', 'PESSOAL');

-- CreateTable
CREATE TABLE "planos" (
    "id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "plano_tipo" NOT NULL,
    "autor_id" UUID NOT NULL,
    "plano_origem_id" UUID,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "planos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disciplinas" (
    "id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "disciplinas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temas" (
    "id" UUID NOT NULL,
    "disciplina_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "temas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subtemas" (
    "id" UUID NOT NULL,
    "tema_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "duracao_estimada_min" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "subtemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pesos_disciplina" (
    "id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "disciplina_id" UUID NOT NULL,
    "peso_percentual" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pesos_disciplina_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planos_autor_id_idx" ON "planos"("autor_id");

-- CreateIndex
CREATE INDEX "disciplinas_plano_id_idx" ON "disciplinas"("plano_id");

-- CreateIndex
CREATE INDEX "temas_disciplina_id_idx" ON "temas"("disciplina_id");

-- CreateIndex
CREATE INDEX "subtemas_tema_id_idx" ON "subtemas"("tema_id");

-- CreateIndex
CREATE UNIQUE INDEX "pesos_disciplina_plano_id_disciplina_id_key" ON "pesos_disciplina"("plano_id", "disciplina_id");

-- AddForeignKey
ALTER TABLE "planos" ADD CONSTRAINT "planos_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos" ADD CONSTRAINT "planos_plano_origem_id_fkey" FOREIGN KEY ("plano_origem_id") REFERENCES "planos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinas" ADD CONSTRAINT "disciplinas_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temas" ADD CONSTRAINT "temas_disciplina_id_fkey" FOREIGN KEY ("disciplina_id") REFERENCES "disciplinas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subtemas" ADD CONSTRAINT "subtemas_tema_id_fkey" FOREIGN KEY ("tema_id") REFERENCES "temas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pesos_disciplina" ADD CONSTRAINT "pesos_disciplina_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pesos_disciplina" ADD CONSTRAINT "pesos_disciplina_disciplina_id_fkey" FOREIGN KEY ("disciplina_id") REFERENCES "disciplinas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

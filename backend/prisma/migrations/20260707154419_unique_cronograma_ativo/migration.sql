-- Invariante "1 cronograma ativo por aluno" garantida no banco por índice
-- único parcial (não representável no schema Prisma; ver comentário no model
-- Cronograma). Cobre corridas entre gerações concorrentes.
CREATE UNIQUE INDEX "cronogramas_aluno_id_ativo_unique"
  ON "cronogramas" ("aluno_id")
  WHERE "ativo" AND "deleted_at" IS NULL;

-- Defesa em profundidade para RN-2 (0 <= erros <= total, total >= 1): a
-- invariante é validada no service (422), mas o CHECK impede que escrita
-- direta/bug futuro persista valores inconsistentes. Prisma não expressa
-- CHECK no schema; constraint mantida só via SQL (o diff do migrate ignora).
ALTER TABLE "registro_questoes"
  ADD CONSTRAINT "registro_questoes_valores_check"
  CHECK ("total" >= 1 AND "erros" >= 0 AND "erros" <= "total");

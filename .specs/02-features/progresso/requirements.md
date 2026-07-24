# Progresso — Requisitos

**Fase: [MVP]**

## Objetivo

Permitir que o **aluno** marque **subtemas** como concluídos e visualizar o **percentual de progresso** agregado hierarquicamente: **subtema → tema → disciplina → plano**. O progresso é sempre relativo ao **plano ativo/seguido pelo aluno** e escopado ao próprio usuário.

O subtema é a menor unidade de estudo e de progresso (ver [Subtema](../../01-arquitetura/data-model.md#subtema)). O estado de conclusão é registrado em [ProgressoSubtema](../../01-arquitetura/data-model.md#progressosubtema).

## User stories

- **US-01** — Como **aluno**, quero marcar um subtema como concluído, para registrar meu avanço no conteúdo.
- **US-02** — Como **aluno**, quero desmarcar um subtema concluído, para corrigir um registro equivocado.
- **US-03** — Como **aluno**, quero ver o percentual de conclusão de cada tema, disciplina e do plano inteiro, para saber quanto já cobri.
- **US-04** — Como **aluno**, quero ver quais subtemas ainda faltam em um tema/disciplina, para priorizar o estudo.

## Critérios de aceitação (testáveis)

- **CA-01** — Marcar um subtema como concluído cria/atualiza `ProgressoSubtema` com `concluido=true` e `concluido_em` = agora (UTC).
- **CA-02** — Desmarcar define `concluido=false` e `concluido_em=null`.
- **CA-03** — Existe no máximo **um** `ProgressoSubtema` por `(aluno_id, subtema_id)` (unique); nova marcação do mesmo par atualiza o registro existente (idempotente, `200`).
- **CA-04** — O progresso de um **tema** = (nº de subtemas do tema com `concluido=true` para o aluno) / (nº total de subtemas do tema) × 100.
- **CA-05** — O progresso de uma **disciplina** = (nº de subtemas concluídos em todos os temas da disciplina) / (nº total de subtemas da disciplina) × 100.
- **CA-06** — O progresso do **plano** = (nº de subtemas concluídos no plano) / (nº total de subtemas do plano) × 100.
- **CA-07** — Tema/disciplina/plano **sem subtemas** retorna progresso `0%` (sem divisão por zero).
- **CA-08** — Um aluno só acessa seu próprio progresso; consultar/alterar progresso de outro aluno retorna `403 FORBIDDEN`.
- **CA-09** — Marcar progresso de um `subtema_id` inexistente retorna `404 NOT_FOUND`.
- **CA-10** — Os percentuais são calculados sob demanda a partir da árvore do plano e dos registros de `ProgressoSubtema` do aluno (consistentes com marcações mais recentes).

## Regras de negócio

- **RN-01 — Unidade de progresso.** Só subtemas têm estado de conclusão. Tema, disciplina e plano têm progresso **derivado** (calculado), nunca armazenado.
- **RN-02 — Contagem por subtemas (não ponderada por peso).** No MVP, o progresso hierárquico é a razão de subtemas concluídos sobre o total, em cada nível. O `PesoDisciplina` **não** entra no cálculo de progresso (peso influencia o cronograma, não a conclusão). Ver [Nota de fórmula](design.md#cálculo-do-percentual).
- **RN-03 — Escopo por aluno.** Todo cálculo e marcação é relativo ao `aluno_id` autenticado e ao plano informado.
- **RN-04 — Denominador = total de subtemas ativos.** Subtemas soft-deleted não contam no total nem no numerador.
- **RN-05 — Idempotência.** Marcar/desmarcar é idempotente: repetir a mesma operação mantém o mesmo estado.

## Casos de borda

- **CB-01** — Tema sem subtemas → 0% (não conta como 100%).
- **CB-02** — Todos os subtemas concluídos → 100% no tema/disciplina/plano correspondente.
- **CB-03** — Subtema adicionado ao plano após marcações: aumenta o denominador, reduzindo o percentual — o cálculo sob demanda reflete isso automaticamente.
- **CB-04** — Aluno com plano PESSOAL derivado: o progresso é medido sobre os subtemas **copiados** do plano pessoal (ids próprios), independente do progresso no oficial (ver [plano-de-estudo](../plano-de-estudo/requirements.md)).
- **CB-05** — Marcar subtema já concluído novamente: `200`, `concluido_em` **não** é reescrito (preserva a data original da conclusão).
- **CB-06** — Desmarcar subtema nunca marcado: cria/mantém registro com `concluido=false` (ou retorna estado inalterado), sem erro.

## Dependências

- [00-visao-produto.md](../../00-visao-produto.md) — métrica de conclusão (§4).
- [01-arquitetura/data-model.md](../../01-arquitetura/data-model.md) — `ProgressoSubtema`, `Subtema`, `Tema`, `Disciplina`, `Plano`.
- [01-arquitetura/api-conventions.md](../../01-arquitetura/api-conventions.md) — REST, erros, escopo por usuário.
- [plano-de-estudo](../plano-de-estudo/requirements.md) — árvore Disciplina→Tema→Subtema origem do denominador.
- [design.md](design.md) · [tasks.md](tasks.md)

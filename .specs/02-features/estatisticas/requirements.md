# Estatísticas — Requisitos

**Fase:** MVP (métricas básicas) + Fase 2 (métricas avançadas, marcadas abaixo).

## Objetivo

Dar ao aluno visibilidade sobre seu próprio esforço e evolução, derivando métricas
de estudo exclusivamente a partir dos registros já existentes ([`SessaoEstudo`](../../01-arquitetura/data-model.md#sessaoestudo),
[`ProgressoSubtema`](../../01-arquitetura/data-model.md#progressosubtema),
[`RegistroQuestoes`](../../01-arquitetura/data-model.md#registroquestoes)). Nenhuma
estatística introduz dado novo: tudo é **agregação de leitura** sobre o que o aluno já registrou.

## User stories

- **US-01** (MVP) — Como aluno, quero ver o **total de horas** que já estudei, para medir meu esforço acumulado.
- **US-02** (MVP) — Como aluno, quero ver **horas estudadas por disciplina**, para saber onde concentrei tempo.
- **US-03** (MVP) — Como aluno, quero ver meu **% de progresso** (subtemas concluídos vs. planejados), para saber o quanto do plano cobri.
- **US-04** (MVP) — Como aluno, quero ver a **evolução das horas ao longo do tempo** (por dia/semana), para acompanhar minha constância.
- **US-05** (MVP) — Como aluno, quero ver meu **desempenho em questões** (total, erros, taxa de erro), para identificar pontos fracos.
- **US-06** (Fase 2) — Como aluno, quero **comparar** meu desempenho com a média da minha turma, para me situar entre os pares.
- **US-07** (Fase 2) — Como aluno, quero ver **tendências** (médias móveis, projeção de conclusão), para prever se termino o edital no prazo.

## Critérios de aceitação (testáveis)

- **CA-01** (MVP) — O total de horas equivale a `SUM(duracao_min)` das `SessaoEstudo` do aluno com `fim` preenchido, dividido por 60; sessões com cronômetro em andamento (`fim` nulo) **não** entram.
- **CA-02** (MVP) — Horas por disciplina retornam uma linha por `disciplina_id` com `SUM(duracao_min)`, incluindo apenas disciplinas com ao menos uma sessão (não retorna disciplinas com 0h).
- **CA-03** (MVP) — Progresso % = `COUNT(ProgressoSubtema concluido=true) / COUNT(subtemas do plano ativo) * 100`, arredondado a 1 casa; se o plano ativo não tem subtemas, retorna `0`.
- **CA-04** (MVP) — Série temporal aceita `granularidade=dia|semana` e intervalo `from`/`to`; agrupa horas por bucket de tempo no `timezone` do cronograma ativo do aluno; buckets sem estudo retornam `0` (série contínua, sem lacunas).
- **CA-05** (MVP) — Desempenho em questões retorna `total`, `erros` e `taxaErro = erros/total` (0 se `total=0`), agregável por disciplina/tema.
- **CA-06** — Todas as respostas são **escopadas ao aluno autenticado**; um aluno que solicite estatísticas de outro recebe `403` (ver [api-conventions](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)).
- **CA-07** (Fase 2) — Comparativo com a turma só é retornado se o aluno tiver [`Matricula`](../../01-arquitetura/data-model.md#matricula) `ATIVA` na turma solicitada; caso contrário `403`.

## Regras de negócio

- **RN-01** — "Hora estudada" considera somente sessões finalizadas (`fim IS NOT NULL`); a soma usa `duracao_min`.
- **RN-02** — O universo de subtemas para progresso é o do **plano ativo** do aluno ([`AlunoPlanoAtivo`](../../01-arquitetura/data-model.md#1-erd-texto)); mudar o plano ativo muda o denominador.
- **RN-03** — Agregações temporais respeitam o `timezone` do [`Cronograma`](../../01-arquitetura/data-model.md#cronograma) ativo (default `America/Sao_Paulo`) para definir os limites de dia/semana; a semana inicia na segunda-feira.
- **RN-04** — `taxaErro` é **derivada**, nunca persistida (coerente com [`RegistroQuestoes`](../../01-arquitetura/data-model.md#registroquestoes)).
- **RN-05** (Fase 2) — A média da turma é calculada apenas sobre alunos com matrícula `ATIVA`; alunos sem sessões contam como 0h (não são excluídos da média).

## Casos de borda

- Aluno sem nenhuma sessão → todas as métricas de horas retornam `0` e séries vazias (mas contínuas dentro do intervalo pedido).
- Aluno sem plano ativo → progresso `0` e horas por disciplina ainda funcionam (sessões podem existir de plano anterior).
- Intervalo `from` > `to` → `422 VALIDATION_ERROR`.
- Sessão manual retroativa (data anterior a `from`) → não entra no bucket, mas entra no total acumulado.
- Disciplina removida (soft delete) que possui sessões antigas → aparece nas estatísticas históricas com seu nome preservado.

## Dependências

- [cronometro-e-sessoes](../cronometro-e-sessoes/requirements.md) — origem de `SessaoEstudo`.
- [progresso](../progresso/requirements.md) — origem de `ProgressoSubtema`.
- [questoes-e-desempenho](../questoes-e-desempenho/requirements.md) — origem de `RegistroQuestoes`.
- [plano-de-estudo](../plano-de-estudo/requirements.md) — define o universo de disciplinas/subtemas.
- [gamificacao-ranking](../gamificacao-ranking/requirements.md) (Fase 2) — reaproveita as mesmas agregações de horas/subtemas.

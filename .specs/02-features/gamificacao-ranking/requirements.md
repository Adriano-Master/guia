# Gamificação e Ranking — Requisitos

**Fase:** Fase 2 (tudo).

## Objetivo

Gerar disciplina e motivação por comparação com pares, expondo **rankings** — por turma
e global — a partir de uma pontuação agregada por aluno ([`PontuacaoAluno`](../../01-arquitetura/data-model.md#pontuacaoaluno)).
A pontuação recompensa conclusão de conteúdo, tempo estudado e constância.

## User stories

- **US-01** — Como aluno, quero ver o **ranking da minha turma**, para me comparar com colegas.
- **US-02** — Como aluno, quero ver o **ranking global**, para me situar entre todos os alunos.
- **US-03** — Como aluno, quero ver **minha posição e minha pontuação** (e do que ela é composta), para saber como subir.
- **US-04** — Como aluno, quero que minha pontuação **reflita constância** (estudar em vários dias), não só volume, para ser recompensado por regularidade.
- **US-05** — Como professor, quero ver o ranking das minhas turmas, para acompanhar engajamento.

## Critérios de aceitação (testáveis)

- **CA-01** — A pontuação de um aluno segue exatamente a fórmula definida em [design](design.md#fórmula-de-pontuação); dados iguais produzem pontuação igual (determinística).
- **CA-02** — O ranking é ordenado por `pontos` desc; empate desempatado por `subtemas_concluidos` desc e depois `atualizado_em` asc (quem chegou à pontuação primeiro fica na frente).
- **CA-03** — `GET /api/v1/ranking/global` e `GET /api/v1/ranking/turmas/{turmaId}` são **paginados** (`page`/`pageSize`, ver [api-conventions §4](../../01-arquitetura/api-conventions.md#4-paginação-filtro-ordenação)).
- **CA-04** — O ranking de turma inclui **apenas** alunos com [`Matricula`](../../01-arquitetura/data-model.md#matricula) `ATIVA` naquela turma.
- **CA-05** — Um aluno só acessa o ranking de turmas em que tem matrícula ATIVA; caso contrário `403`. Professor acessa rankings das turmas que leciona.
- **CA-06** — `GET /api/v1/ranking/me` retorna a posição global e por turma do aluno autenticado, com o detalhamento (subtemas, horas, bônus).
- **CA-07** — Após a recomputação agendada, `PontuacaoAluno.atualizado_em` reflete o horário do último cálculo.

## Regras de negócio

- **RN-01** — Existe **um** registro `PontuacaoAluno` por aluno (unique `aluno_id`), agregando toda a atividade dele — não é por turma. O ranking de turma reordena os mesmos agregados filtrando por matrícula.
- **RN-02** — Horas contam apenas sessões finalizadas (`fim IS NOT NULL`), coerente com [estatísticas RN-01](../estatisticas/requirements.md#regras-de-negócio).
- **RN-03** — Subtemas concluídos = `COUNT(ProgressoSubtema concluido=true)` do aluno.
- **RN-04** — Constância é medida em **dias distintos de estudo por semana**; o bônus é definido na fórmula em [design](design.md#fórmula-de-pontuação).
- **RN-05** — Alunos `INATIVO` (ex.: acesso revogado via Hotmart) são **omitidos** dos rankings, mas seu `PontuacaoAluno` é preservado.
- **RN-06** — A pontuação é **materializada**: consultas de ranking leem `PontuacaoAluno`, nunca recalculam em tempo real.

## Casos de borda

- Aluno sem nenhuma atividade → `PontuacaoAluno` com `pontos=0`; aparece no fim do ranking.
- Turma sem alunos ativos → ranking vazio (`data: []`, `total: 0`).
- Aluno em várias turmas → mesmo agregado aparece em cada ranking de turma; a posição varia conforme os pares.
- `pageSize` acima do máximo (100) → limitado a 100 (api-conventions).
- Aluno recém-matriculado antes da 1ª recomputação → aparece com pontos da última execução (0 se nunca calculado).

## Dependências

- [estatisticas](../estatisticas/requirements.md) — reaproveita agregações de horas e subtemas.
- [turmas](../turmas/requirements.md) — matrículas que definem o escopo do ranking de turma.
- [cronometro-e-sessoes](../cronometro-e-sessoes/requirements.md) e [progresso](../progresso/requirements.md) — insumos da pontuação.
- [auth-e-usuarios](../auth-e-usuarios/requirements.md) — status do usuário (INATIVO omitido).

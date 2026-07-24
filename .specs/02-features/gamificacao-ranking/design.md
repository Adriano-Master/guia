# Gamificação e Ranking — Design

**Fase:** Fase 2.

## Entidades envolvidas

Fonte: [data-model.md](../../01-arquitetura/data-model.md). Nenhuma entidade nova.

- [`PontuacaoAluno`](../../01-arquitetura/data-model.md#pontuacaoaluno) — agregado materializado (`pontos`, `subtemas_concluidos`, `horas_estudadas`, `atualizado_em`). **Escrito só pelo job**, lido pelos endpoints.
- [`User`](../../01-arquitetura/data-model.md#user) — nome/role; `status=INATIVO` omitido do ranking.
- [`Matricula`](../../01-arquitetura/data-model.md#matricula) / [`Turma`](../../01-arquitetura/data-model.md#turma) — escopo do ranking por turma.
- [`SessaoEstudo`](../../01-arquitetura/data-model.md#sessaoestudo) — horas e dias distintos (constância).
- [`ProgressoSubtema`](../../01-arquitetura/data-model.md#progressosubtema) — subtemas concluídos.

## Fórmula de pontuação

Pontuação de um aluno (inteiro, coluna `pontos`):

```
pontos = (PTS_SUBTEMA   * subtemas_concluidos)
       + (PTS_HORA      * floor(horas_estudadas))
       + (PTS_BONUS_SEM * semanas_consistentes)
```

Constantes (configuráveis por env; valores default):

| Constante | Valor | Significado |
|---|---|---|
| `PTS_SUBTEMA` | **10** | pontos por subtema concluído (`ProgressoSubtema.concluido=true`). |
| `PTS_HORA` | **5** | pontos por hora **inteira** estudada (`floor(SUM(duracao_min)/60)`, sessões finalizadas). |
| `PTS_BONUS_SEM` | **50** | bônus por semana consistente. |

Definições:

- `horas_estudadas = SUM(duracao_min WHERE fim IS NOT NULL) / 60` (materializado como `numeric`; a pontuação usa `floor`).
- `subtemas_concluidos = COUNT(ProgressoSubtema WHERE concluido=true)`.
- **`semanas_consistentes`** = número de semanas ISO em que o aluno estudou em **≥ 5 dias distintos** (dias com ao menos uma `SessaoEstudo` finalizada). Recompensa regularidade em vez de "maratonas" (RN-04). A semana usa o `timezone` do cronograma ativo, iniciando na segunda-feira (coerente com [estatísticas RN-03](../estatisticas/requirements.md#regras-de-negócio)).

Exemplo: 30 subtemas + 40h + 4 semanas consistentes → `10*30 + 5*40 + 50*4 = 300 + 200 + 200 = 700`.

**Desempate no ranking:** `pontos` desc → `subtemas_concluidos` desc → `atualizado_em` asc (CA-02).

## Atualização do agregado

**Decisão: job agendado (batch), não trigger.**

- Um **cron job** (`RankingScheduler`) roda periodicamente (default a cada 1h; noturno para consolidação) e recomputa `PontuacaoAluno` para todos os alunos ativos, via `UPSERT` (`ON CONFLICT (aluno_id)`), atualizando `atualizado_em`.
- Motivo de não usar trigger: a fórmula agrega múltiplas tabelas e janela semanal; triggers por linha (em `SessaoEstudo`/`ProgressoSubtema`) seriam custosos e difíceis de manter consistentes. Ranking tolera latência de minutos/horas (RN-06).
- **Recomputação incremental opcional:** endpoint interno/evento pode enfileirar recomputo de um único aluno após concluir subtema, para feedback mais rápido — mesma função de cálculo, escopo de 1 `aluno_id`.
- Idempotência do job: recomputar N vezes com os mesmos dados produz o mesmo `pontos` (CA-01).

## Endpoints REST

Base `/api/v1/ranking`. Exigem **JWT**. Paginação e ordenação por [api-conventions §4](../../01-arquitetura/api-conventions.md#4-paginação-filtro-ordenação).

| Método | Rota | Autorização | Descrição |
|---|---|---|---|
| GET | `/ranking/global` | Qualquer autenticado | Ranking de todos os alunos ATIVOS, paginado. |
| GET | `/ranking/turmas/{turmaId}` | Aluno com matrícula ATIVA na turma **ou** professor da turma (senão `403`) | Ranking dos alunos ATIVOS matriculados na turma. |
| GET | `/ranking/me` | Aluno | Posição global e por turma do próprio aluno, com composição da pontuação. |

Resposta paginada (`/ranking/global`):
```json
{
  "data": [
    { "posicao": 1, "alunoId": "…", "nome": "Ana", "pontos": 700,
      "subtemasConcluidos": 30, "horasEstudadas": 40.0 }
  ],
  "page": 1, "pageSize": 20, "total": 137
}
```
`posicao` é calculada sobre o conjunto ordenado completo (não só a página). Erros seguem o envelope padrão ([api-conventions §5](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão)).

## Fluxos

### Recomputação agendada
1. Scheduler dispara `RankingService.recomputarTodos()`.
2. Para cada aluno ATIVO: calcula `subtemas_concluidos`, `horas_estudadas`, `semanas_consistentes`.
3. Aplica a fórmula → `pontos`; `UPSERT` em `PontuacaoAluno` com `atualizado_em = now()`.

### Consulta de ranking de turma
1. Controller valida `turmaId` e autorização (matrícula ATIVA ou professor da turma) → senão `403`.
2. `RankingService.porTurma(turmaId, page, pageSize)`: `JOIN PontuacaoAluno ↔ Matricula(status=ATIVA, turma_id) ↔ User(status=ATIVO)`, ordena pela regra de desempate, aplica `LIMIT/OFFSET`.
3. Calcula `posicao` (`ROW_NUMBER()` sobre o conjunto ordenado) e serializa.

## Decisões técnicas

- **Materialização + batch** em vez de cálculo on-the-fly ou trigger (ver acima).
- **Um agregado por aluno**, reordenado por escopo (global/turma) — evita duplicação por turma e mantém `PontuacaoAluno` fiel ao data-model (unique `aluno_id`).
- **Constantes por env** (`PTS_SUBTEMA`, `PTS_HORA`, `PTS_BONUS_SEM`) para tunar o balanceamento sem migração.
- **Reuso**: `horas_estudadas` e `subtemas_concluidos` vêm das mesmas agregações de [estatísticas](../estatisticas/design.md#decisões-técnicas).

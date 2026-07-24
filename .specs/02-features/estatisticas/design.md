# Estatísticas — Design

## Entidades envolvidas

Somente **leitura** — nenhuma entidade nova. Fonte: [data-model.md](../../01-arquitetura/data-model.md).

- [`SessaoEstudo`](../../01-arquitetura/data-model.md#sessaoestudo) — horas (por `duracao_min`, `disciplina_id`, `inicio`).
- [`ProgressoSubtema`](../../01-arquitetura/data-model.md#progressosubtema) — progresso concluído.
- [`RegistroQuestoes`](../../01-arquitetura/data-model.md#registroquestoes) — desempenho em questões.
- [`Disciplina`](../../01-arquitetura/data-model.md#disciplina) / [`Tema`](../../01-arquitetura/data-model.md#tema) / [`Subtema`](../../01-arquitetura/data-model.md#subtema) — dimensões e denominador do progresso.
- [`Matricula`](../../01-arquitetura/data-model.md#matricula) / [`Turma`](../../01-arquitetura/data-model.md#turma) — escopo dos comparativos (Fase 2).

Índices já previstos que sustentam as consultas: `SessaoEstudo(aluno_id, inicio)`,
`RegistroQuestoes(aluno_id, tema_id, data)`, `ProgressoSubtema(aluno_id, subtema_id)`
(ver [data-model §8](../../01-arquitetura/data-model.md#8-índices-e-integridade-destaques)).

## Endpoints REST

Base `/api/v1/estatisticas`. Todos exigem **JWT** e são escopados ao aluno autenticado
(`aluno_id = req.user.id`); acesso cruzado → `403` (ver [api-conventions](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)).
Somente leitura (`GET`).

| Método | Rota | Fase | Descrição |
|---|---|---|---|
| GET | `/estatisticas/resumo` | MVP | Cartões do dashboard: horas totais, progresso %, questões (total/erros/taxa). |
| GET | `/estatisticas/horas-por-disciplina` | MVP | Horas agregadas por disciplina. Filtros `from`/`to` opcionais. |
| GET | `/estatisticas/serie-temporal` | MVP | Horas por bucket. Query `granularidade=dia\|semana` (default `dia`), `from`, `to`. |
| GET | `/estatisticas/progresso` | MVP | % de subtemas concluídos; detalhamento por disciplina via `?porDisciplina=true`. |
| GET | `/estatisticas/desempenho-questoes` | MVP | Total, erros, taxa de erro; agrupável via `?agruparPor=disciplina\|tema`. |
| GET | `/estatisticas/comparativo` | **Fase 2** | Aluno vs. média da turma. Query `turmaId` (obrigatório); exige matrícula ATIVA. |
| GET | `/estatisticas/tendencias` | **Fase 2** | Média móvel de horas e projeção de conclusão do plano. |

Exemplo de resposta (`/estatisticas/horas-por-disciplina`):
```json
{
  "data": [
    { "disciplinaId": "…", "disciplina": "Português", "horas": 12.5 },
    { "disciplinaId": "…", "disciplina": "Direito Constitucional", "horas": 8.0 }
  ],
  "totalHoras": 20.5
}
```

Erros seguem o envelope padrão de [api-conventions §5](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão)
(`422` para intervalo inválido, `403` para escopo cruzado).

## Fluxos

### Consulta de horas totais / por disciplina (MVP)
1. Controller valida DTO de query (`from`/`to` opcionais, ISO-8601).
2. `EstatisticasService.horasPorDisciplina(alunoId, filtro)`.
3. Repository executa agregação:
   `SELECT disciplina_id, SUM(duracao_min) FROM sessoes_estudo WHERE aluno_id=$1 AND fim IS NOT NULL [AND inicio BETWEEN $from AND $to] GROUP BY disciplina_id`.
4. Service converte min→horas, faz `JOIN` com nome da disciplina, serializa em `camelCase`.

### Série temporal (MVP)
1. Service determina `timezone` do cronograma ativo.
2. Agregação com `date_trunc('day'|'week', inicio AT TIME ZONE tz)` somando `duracao_min`.
3. Service **preenche buckets vazios** entre `from` e `to` com `0` (série contínua — RN-03/CA-04).

### Progresso (MVP)
- Denominador: `COUNT(subtemas)` do plano ativo (via `AlunoPlanoAtivo → Plano → Disciplina → Tema → Subtema`).
- Numerador: `COUNT(ProgressoSubtema WHERE aluno_id=$1 AND concluido=true AND subtema pertence ao plano ativo)`.
- `%` = numerador/denominador × 100 (0 se denominador 0).

### Comparativo (Fase 2)
1. Verifica `Matricula` ATIVA do aluno na `turmaId` → senão `403`.
2. Calcula a métrica do aluno e a média sobre todos os alunos ATIVOS da turma (RN-05).
3. Retorna par `{ aluno, mediaTurma }` por métrica.

## Decisões técnicas

- **Sem materialização no MVP:** as métricas são calculadas on-the-fly por agregação SQL, apoiadas nos índices existentes. Materialização (views/cache) fica para Fase 2 se houver gargalo.
- **Fuso horário:** buckets diários/semanais usam o `timezone` do cronograma ativo (não UTC bruto), para que "hoje" case com a percepção do aluno; datas de fronteira são convertidas com `AT TIME ZONE` (coerente com ADR-03 do [overview](../../01-arquitetura/overview.md#8-decisões-em-aberto-adr)).
- **`taxaErro` derivada:** calculada na serialização, nunca persistida.
- **Reuso:** as agregações de horas totais e subtemas concluídos são as **mesmas** consumidas por [gamificação](../gamificacao-ranking/design.md) — extrair para funções de repositório compartilháveis.

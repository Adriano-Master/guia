# Questões e Desempenho — Design

**Fase:** registro e desempenho são **[MVP]**; recomendação é **[Fase 2]** (marcada abaixo).

## Entidades envolvidas

Da [fonte única de entidades](../../01-arquitetura/data-model.md):

- [`RegistroQuestoes`](../../01-arquitetura/data-model.md#registroquestoes) — entidade central (`aluno_id`, `tema_id`, `subtema_id?`, `data`, `total`, `erros`; `taxa_erro` **derivada**, não armazenada).
- [`Tema`](../../01-arquitetura/data-model.md#tema) e [`Subtema`](../../01-arquitetura/data-model.md#subtema) — alvo do registro.
- [`User`](../../01-arquitetura/data-model.md#user) — o aluno (escopo).

> Nenhuma entidade nova. A recomendação da Fase 2 é **derivada por consulta/agregação** sobre `RegistroQuestoes`, sem tabela adicional.

## Endpoints REST

Base `/api/v1`, JSON `camelCase`, datas ISO-8601 UTC, `Bearer <access>`. Todos exigem role `ALUNO` e são **escopados ao próprio aluno** (acesso cruzado → `403`), conforme [api-conventions §3](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização).

| Método | Rota | Fase | Descrição | Sucesso |
|---|---|---|---|---|
| POST | `/questoes` | **[MVP]** | Cria registro de questões | `201` |
| GET | `/questoes` | **[MVP]** | Lista registros do aluno (paginado, filtros) | `200` |
| GET | `/questoes/{id}` | **[MVP]** | Obtém um registro | `200` / `404` |
| PATCH | `/questoes/{id}` | **[MVP]** | Corrige `total`/`erros`/`subtemaId` | `200` |
| DELETE | `/questoes/{id}` | **[MVP]** | Remove registro | `204` |
| GET | `/questoes/desempenho` | **[MVP]** | Agregado por tema no período | `200` |
| GET | `/questoes/recomendacoes` | **[Fase 2]** | Temas recomendados por taxa de erro | `200` |

### Contratos (resumo)

**POST `/questoes`** — **[MVP]**
```json
// request
{ "temaId": "uuid", "subtemaId": "uuid?", "data": "2026-07-06", "total": 20, "erros": 8 }
// 201  (taxaErro derivado, não persistido)
{ "id": "uuid", "temaId": "uuid", "subtemaId": null, "data": "2026-07-06", "total": 20, "erros": 8, "taxaErro": 0.4 }
```
> `422` se `erros > total`, `total < 1`, `data` futura, ou `subtemaId` não filho de `temaId`.

**GET `/questoes/desempenho`** — **[MVP]** — filtros `?temaId=&from=&to=`
```json
// 200
{ "data": [ { "temaId": "uuid", "totalQuestoes": 60, "totalErros": 27, "taxaErro": 0.45 } ], "from": "2026-06-01", "to": "2026-06-30" }
```

**GET `/questoes/recomendacoes`** — **[Fase 2]** — filtros `?from=&to=&limiar=0.5&nMin=20`
```json
// 200
{ "data": [ { "temaId": "uuid", "totalQuestoes": 60, "totalErros": 39, "taxaErro": 0.65, "motivo": "taxa de erro 65% acima do limiar em amostra de 60 questões" } ] }
```

Erros seguem o [envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão).

## Fluxos

### Registrar questões — [MVP]
```
Controller valida DTO (total>=1, 0<=erros<=total, data<=hoje)
  → Service.registrar(alunoId, dto)
      → valida tema existe e subtema (se houver) é filho do tema (RN-4)
      → INSERT RegistroQuestoes
      → responde com taxaErro = erros/total (RN-3)
```

### Desempenho agregado — [MVP]
```
Service.desempenho(alunoId, {temaId?, from, to})
  → SELECT tema_id, SUM(total) AS totalQuestoes, SUM(erros) AS totalErros
    FROM registro_questoes
    WHERE aluno_id=? AND data BETWEEN from AND to [AND tema_id=?]
    GROUP BY tema_id
  → taxaErro = totalErros / NULLIF(totalQuestoes,0)   (0 se sem questões)
```

### Recomendação — [Fase 2]
```
Service.recomendacoes(alunoId, {from, to, limiar=LIMIAR, nMin=N_MIN})
  → reaproveita a agregação de desempenho
  → filtra temas onde totalQuestoes >= nMin AND taxaErro >= limiar   (RN-6)
  → ordena por taxaErro desc, empate por totalErros desc             (RN-7)
  → monta 'motivo' legível por item
```

## Fórmula da recomendação (Fase 2)

Para cada tema `t` no período `[from, to]` do aluno:

```
totalQuestoes(t) = Σ total   dos registros do tema no período
totalErros(t)    = Σ erros   dos registros do tema no período
taxaErro(t)      = totalErros(t) / totalQuestoes(t)

t é RECOMENDADO  ⇔  totalQuestoes(t) ≥ N_MIN   E   taxaErro(t) ≥ LIMIAR
```

- **N_MIN** (amostra mínima) — default **20** questões. Evita recomendar por acaso estatístico (CA-10, RN-6). Faixa válida: `5 ≤ N_MIN ≤ 200`.
- **LIMIAR** (taxa de erro mínima) — default **0,50** (50%). Faixa válida: `0,30 ≤ LIMIAR ≤ 0,90`.
- **Ordenação** — `taxaErro` desc; desempate por `totalErros` desc (RN-7).
- Parâmetros sobreponíveis por query `?nMin=&limiar=` dentro das faixas (RN-8); fora da faixa → `422` (CB-6).

**Exemplo:** tema com 60 questões e 39 erros → `taxaErro = 0,65`. Com defaults (`N_MIN=20`, `LIMIAR=0,50`): `60 ≥ 20` e `0,65 ≥ 0,50` → **recomendado**. Um tema com 8 questões e 7 erros (`0,875`) é **excluído** por `8 < 20`.

## Decisões técnicas

- **D-1 (taxa nunca persistida)** — `taxa_erro` é sempre calculada em leitura (RN-3), evitando inconsistência ao editar `total`/`erros`.
- **D-2 (recomendação sem tabela)** — Fase 2 é pura agregação SQL sobre `RegistroQuestoes`; não cria entidade nova (respeita a fonte única). Materialização/cache fica como otimização futura, não requerida.
- **D-3 (período default)** — Quando `from`/`to` ausentes em desempenho/recomendações, usa os **últimos 30 dias** até hoje.
- **D-4 (índice)** — Usa o índice previsto `RegistroQuestoes(aluno_id, tema_id, data)` ([data-model §8](../../01-arquitetura/data-model.md#8-índices-e-integridade-destaques)) para as agregações filtradas por período.
- **D-5 (divisão segura)** — Agregações usam `NULLIF(total,0)` para evitar divisão por zero; a validação de `total ≥ 1` no registro já impede o caso na prática (CB-1).
- **D-6 (parâmetros da recomendação)** — `N_MIN`/`LIMIAR` como constantes de configuração do módulo, sobreponíveis por query com validação de faixa.

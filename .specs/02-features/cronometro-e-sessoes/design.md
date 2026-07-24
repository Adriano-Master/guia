# Cronômetro e Sessões — Design

**Fase:** MVP.

## Entidades envolvidas

Todas definidas na [fonte única de entidades](../../01-arquitetura/data-model.md):

- [`SessaoEstudo`](../../01-arquitetura/data-model.md#sessaoestudo) — entidade central (`aluno_id`, `disciplina_id`, `subtema_id?`, `bloco_id?`, `origem`, `inicio`, `fim?`, `duracao_min`).
- [`Disciplina`](../../01-arquitetura/data-model.md#disciplina) e [`Subtema`](../../01-arquitetura/data-model.md#subtema) — alvo do estudo.
- [`BlocoCronograma`](../../01-arquitetura/data-model.md#blococronograma) — vínculo opcional com o calendário.
- [`User`](../../01-arquitetura/data-model.md#user) — o aluno (escopo).

> **Nota sobre pausa:** o `data-model` não possui coluna para pausas. O estado de pausa é mantido **em memória do cronômetro no cliente** e reconciliado no stop; o servidor recebe, no `POST /sessoes/ativa/stop`, o total de minutos pausados (`pausaMin`) para descontar no cálculo. Nenhuma entidade nova é introduzida. Ver [decisão D-3](#decisões-técnicas).

## Endpoints REST

Base `/api/v1`, JSON `camelCase`, datas ISO-8601 UTC, autenticação `Bearer <access>`. Todos os endpoints exigem role `ALUNO` autenticado e são **escopados ao próprio aluno** (acesso cruzado → `403`), conforme [api-conventions §3](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização).

| Método | Rota | Descrição | Sucesso |
|---|---|---|---|
| POST | `/sessoes/cronometro/start` | Inicia cronômetro (RN-1) | `201` |
| GET | `/sessoes/ativa` | Retorna o cronômetro em andamento (ou `204`/vazio) | `200` |
| POST | `/sessoes/ativa/pause` | Pausa o cronômetro em andamento | `200` |
| POST | `/sessoes/ativa/resume` | Retoma o cronômetro pausado | `200` |
| POST | `/sessoes/ativa/stop` | Para e finaliza; calcula `duracaoMin` | `200` |
| DELETE | `/sessoes/ativa` | Descarta o cronômetro em andamento | `204` |
| POST | `/sessoes/manual` | Registra tempo manual | `201` |
| GET | `/sessoes` | Lista sessões do aluno (paginada, filtros) | `200` |
| GET | `/sessoes/{id}` | Obtém uma sessão do aluno | `200` / `404` |
| PATCH | `/sessoes/{id}` | Corrige `duracaoMin`/`subtemaId` de sessão finalizada | `200` |
| DELETE | `/sessoes/{id}` | Remove sessão | `204` |

### Contratos (resumo)

**POST `/sessoes/cronometro/start`**
```json
// request
{ "disciplinaId": "uuid", "subtemaId": "uuid?", "blocoId": "uuid?" }
// 201
{ "id": "uuid", "origem": "CRONOMETRO", "inicio": "2026-07-06T13:00:00Z", "fim": null, "duracaoMin": 0, "estado": "RUNNING" }
```
> `409 CONFLICT` se já houver sessão `CRONOMETRO` com `fim = null` (RN-1).

**POST `/sessoes/ativa/stop`**
```json
// request (pausaMin = total de minutos pausados acumulados, default 0)
{ "pausaMin": 3 }
// 200
{ "id": "uuid", "fim": "2026-07-06T14:05:00Z", "duracaoMin": 62, "estado": "STOPPED" }
```

**POST `/sessoes/manual`**
```json
// request
{ "disciplinaId": "uuid", "subtemaId": "uuid?", "blocoId": "uuid?", "data": "2026-07-06", "duracaoMin": 45 }
// 201
{ "id": "uuid", "origem": "MANUAL", "inicio": "...", "fim": "...", "duracaoMin": 45 }
```

**GET `/sessoes`** — filtros `?disciplinaId=&from=&to=&page=&pageSize=&sort=-inicio`; resposta paginada padrão `{ data, page, pageSize, total }`.

Erros seguem o [envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão) (`VALIDATION_ERROR` 422, `CONFLICT` 409, `NOT_FOUND` 404, `FORBIDDEN` 403).

## Fluxos

### Máquina de estados do cronômetro

```
        start                 pause                resume
 (none) ──────► RUNNING ──────────────► PAUSED ──────────► RUNNING
                  │  ▲                     │                   │
             stop │  └─────────────────────┘                  │ stop
                  ▼                                            ▼
               STOPPED  ◄───────────────────────────────────── 
                  (fim preenchido, duracao_min calculado)

 RUNNING/PAUSED ── discard ──► (sessão removida, sem registro)
```

- **start** → cria `SessaoEstudo` (`origem=CRONOMETRO`, `inicio=now()`, `fim=null`, `duracao_min=0`). Estado lógico `RUNNING`.
- **pause / resume** → não persistem coluna nova; o cliente acumula `pausaMin` (D-3). Transições inválidas → `409`.
- **stop** → `fim = now()`; `duracao_min = round((fim − inicio) em minutos − pausaMin)`, mínimo 1 se resultado > 0. Estado `STOPPED`.
- **discard** → `DELETE` da sessão em andamento.

### Fluxo — iniciar cronômetro (garantia da RN-1)

```
Controller valida DTO
  → Service.iniciarCronometro(alunoId, dto)
      → em transação: SELECT sessao WHERE aluno_id=? AND origem='CRONOMETRO' AND fim IS NULL FOR UPDATE
          se existe → lança ConflictError (409)
          senão     → valida disciplina/subtema/bloco (CA-8, CA-9) → INSERT
```

### Fluxo — registro manual

```
Controller valida DTO (duracaoMin>0, data<=hoje)
  → Service.registrarManual: monta inicio = data@00:00Z base, fim = inicio + duracaoMin
      → valida disciplina/subtema/bloco → INSERT origem='MANUAL'
```

## Decisões técnicas

- **D-1 (fonte da verdade = servidor)** — O cronômetro "corre" no cliente apenas visualmente; a duração oficial é derivada de `inicio`/`fim` no servidor. Reidratação via `GET /sessoes/ativa`.
- **D-2 (unicidade)** — RN-1 garantida por índice único **parcial** `unique(aluno_id) where origem='CRONOMETRO' and fim is null` **e** verificação transacional (`FOR UPDATE`) para blindar corridas (CB-5). O índice parcial é constraint de banco, não entidade nova.
- **D-3 (pausa sem coluna)** — Como `data-model` não tem campo de pausa, o total pausado é enviado no `stop` (`pausaMin`). Alternativa futura (não-MVP): coluna dedicada — fora de escopo, evita mudar a fonte única agora.
- **D-4 (arredondamento)** — `duracao_min` é inteiro; usa arredondamento para o minuto mais próximo, piso de 1 quando houve tempo positivo.
- **D-5 (não acopla progresso)** — Finalizar sessão não conclui subtema nem bloco automaticamente (RN-5); mantém responsabilidades separadas.
- **D-6 (timezone)** — Persistência em UTC; `data` do registro manual interpretada no TZ do aluno na serialização, conforme [ADR-03](../../01-arquitetura/overview.md#8-decisões-em-aberto-adr).

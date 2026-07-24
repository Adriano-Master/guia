# Convenções de API

> Todo endpoint em qualquer `design.md` DEVE seguir estas convenções.

## 1. Base

- Prefixo: `/api/v1`. Versionamento por caminho.
- REST orientado a recurso; substantivos no plural: `/planos`, `/turmas/{id}/matriculas`.
- JSON em `camelCase` no corpo de request/response (mapeado a partir do `snake_case` do banco na camada de serialização).
- Datas em **ISO-8601 UTC** (`2026-07-06T13:00:00Z`). O cliente converte para o TZ do usuário.

## 2. Métodos e status

| Ação | Método | Sucesso |
|---|---|---|
| Listar | GET | 200 |
| Obter | GET `/{id}` | 200 / 404 |
| Criar | POST | 201 (retorna recurso) |
| Substituir | PUT `/{id}` | 200 |
| Atualizar parcial | PATCH `/{id}` | 200 |
| Remover | DELETE `/{id}` | 204 |

## 3. Autenticação e autorização

- **JWT**: `Authorization: Bearer <access>`. Access curto (~15 min) + refresh (~7 dias) via `POST /auth/refresh`.
- Guard por **role**; papéis internos (`ADMIN`, `MODERADOR`, `PROFESSOR`) vs `ALUNO`.
- Recursos de aluno são **escopados ao próprio usuário**: um aluno só acessa seus cronogramas/sessões/progresso. Acesso cruzado → `403`.
- Endpoints administrativos (criar plano oficial, turma) exigem papel interno.

## 4. Paginação, filtro, ordenação

- Paginação por query: `?page=1&pageSize=20` (default 20, máx 100).
- Resposta paginada:
```json
{ "data": [...], "page": 1, "pageSize": 20, "total": 137 }
```
- Ordenação: `?sort=campo` / `?sort=-campo` (prefixo `-` = desc).
- Filtros por query params nomeados (ex.: `?disciplinaId=...&from=2026-07-01&to=2026-07-31`).

## 5. Formato de erro (padrão)

Todo erro retorna este envelope, com filtro global de exceções:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descrição legível.",
    "details": [ { "field": "pesoPercentual", "issue": "soma deve ser 100" } ],
    "traceId": "..."
  }
}
```
Códigos: `VALIDATION_ERROR` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500).

## 6. Validação

- Todo input validado por **DTO/schema** (class-validator/Zod) no controller antes do service.
- Invariantes de negócio (ex.: Σ pesos = 100) validadas no **service** e refletidas como `422` com `details`.

## 7. Idempotência e concorrência

- Webhooks (Hotmart) idempotentes por `eventoId` (ver [data-model](data-model.md#hotmartwebhookevent)).
- Operações que iniciam recurso único (ex.: iniciar cronômetro quando já há um rodando) retornam `409 CONFLICT`.

## 8. Convenções de nomeação de rotas por feature

Cada `design.md` lista suas rotas. Padrão de agrupamento:
`/auth`, `/users`, `/turmas`, `/planos`, `/planos/{id}/disciplinas`, `/cronogramas`, `/sessoes`, `/progresso`, `/questoes`, `/estatisticas`, `/ranking`, `/webhooks/hotmart`.

# Turmas — Design

**Fase: [MVP]**

## Entidades envolvidas

Todas do [data-model.md](../../01-arquitetura/data-model.md) (fonte única — nenhuma nova):

- **[`Turma`](../../01-arquitetura/data-model.md#turma)** — `id`, `nome`, `descricao`, `professor_id` (FK → `User` interno), `codigo_convite` (único), `ativa`.
- **[`Matricula`](../../01-arquitetura/data-model.md#matricula)** — `id`, `turma_id` (FK → `Turma`), `aluno_id` (FK → `User` `ALUNO`), `status` (`ATIVA`/`INATIVA`), unique `(turma_id, aluno_id)`.
- **[`TurmaPlano`](../../01-arquitetura/data-model.md#turmaplano)** — `id`, `turma_id` (FK → `Turma`), `plano_id` (FK → `Plano` OFICIAL), unique `(turma_id, plano_id)`.
- **[`Plano`](../../01-arquitetura/data-model.md#plano)** (referência, gerido em [plano-de-estudo](../plano-de-estudo/design.md)) — usa-se `tipo = OFICIAL` e `publicado = true` como pré-condição de vínculo.
- **[`User`](../../01-arquitetura/data-model.md#user)** (referência) — `professor_id` (interno) e `aluno_id` (`ALUNO`).

## Endpoints REST

Base `/api/v1` conforme [api-conventions.md](../../01-arquitetura/api-conventions.md). Corpo em `camelCase`. Erros no [envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão).

### Turmas — `/turmas`

| Método | Caminho | Autorização | Request (resumo) | Response (resumo) |
|---|---|---|---|---|
| POST | `/turmas` | Interno (`PROFESSOR`/`MODERADOR`/`ADMIN`) | `{ nome, descricao? }` | `201` `{ turma }` (com `codigoConvite`) |
| GET | `/turmas` | Interno (escopo: suas; `ADMIN`/`MODERADOR` todas) | query `?page&pageSize&sort&ativa` | `200` paginado |
| GET | `/turmas/{id}` | Interno dono / aluno matriculado ativo | — | `200` `{ turma }` / `403` / `404` |
| PATCH | `/turmas/{id}` | Interno dono | `{ nome?, descricao?, ativa? }` | `200` `{ turma }` |
| POST | `/turmas/{id}/regenerar-codigo` | Interno dono | — | `200` `{ codigoConvite }` |
| DELETE | `/turmas/{id}` | Interno dono | — | `204` (soft delete) |

### Matrículas — `/turmas/{id}/matriculas` e `/matriculas`

| Método | Caminho | Autorização | Request (resumo) | Response (resumo) |
|---|---|---|---|---|
| POST | `/matriculas` | `ALUNO` | `{ codigoConvite }` | `201` `{ matricula }` |
| GET | `/turmas/{id}/matriculas` | Interno dono | query `?page&pageSize&status` | `200` paginado (alunos + status) |
| GET | `/matriculas/me` | `ALUNO` | — | `200` lista das matrículas do aluno |
| PATCH | `/matriculas/{id}` | Interno dono ou o próprio aluno | `{ status }` (`ATIVA`/`INATIVA`) | `200` `{ matricula }` |

### Planos da turma — `/turmas/{id}/planos`

| Método | Caminho | Autorização | Request (resumo) | Response (resumo) |
|---|---|---|---|---|
| POST | `/turmas/{id}/planos` | Interno dono | `{ planoId }` (Plano OFICIAL publicado) | `201` `{ turmaPlano }` |
| GET | `/turmas/{id}/planos` | Interno dono / aluno matriculado ativo | query `?page&pageSize` | `200` paginado (planos OFICIAIS) |
| DELETE | `/turmas/{id}/planos/{planoId}` | Interno dono | — | `204` |

**Serializações (resumo):**
- `turma`: `{ id, nome, descricao, professorId, codigoConvite, ativa, createdAt, updatedAt }`.
- `matricula`: `{ id, turmaId, alunoId, status, aluno: { id, nome, email }, createdAt }`.
- `turmaPlano`: `{ id, turmaId, planoId, plano: { id, titulo, tipo, publicado } }`.

## Fluxos principais

### Criar turma
1. Controller valida DTO e role interna (`RolesGuard`).
2. Service gera `codigo_convite` único (retry em colisão), cria `Turma` com `professor_id = req.user.sub`, `ativa = true`.
3. Retorna `201`.

### Matricular aluno (por código)
1. Controller valida `codigoConvite` e role `ALUNO`.
2. Service busca `Turma` pelo código → não achou: `404`; `ativa = false`: `409`.
3. Verifica `Matricula` existente `(turma_id, aluno_id)`:
   - não existe → cria com `status = ATIVA` (`201`);
   - existe `INATIVA` → reativa (`ATIVA`) e retorna `200`;
   - existe `ATIVA` → `409 CONFLICT`.

### Listar alunos da turma
1. `RolesGuard` interno + verificação de dono (ou `ADMIN`/`MODERADOR`).
2. Service pagina `Matricula` da turma com join em `User` (nome/email) e filtro `status`.

### Vincular plano OFICIAL
1. Verifica dono da turma.
2. Service carrega `Plano`: exige `tipo = OFICIAL` e `publicado = true` → senão `422`.
3. Cria `TurmaPlano` (unique `(turma_id, plano_id)` → duplicado `409`).

### Regenerar código
1. Verifica dono. Service gera novo `codigo_convite` único; código antigo deixa de resolver (`404` em novas matrículas). Matrículas existentes intactas.

## Decisões técnicas

- **Geração do código de convite:** string curta alfanumérica (ex.: 8 chars, sem caracteres ambíguos); unicidade garantida por índice + retry no service.
- **Escopo por dono:** guard/serviço compara `turma.professor_id` com `req.user.sub`; `ADMIN`/`MODERADOR` ignoram a checagem de dono (moderação).
- **Escopo do aluno:** endpoints de leitura de turma/planos exigem `Matricula` `ATIVA` do `req.user.sub` naquela turma; caso contrário `403`.
- **Reativação vs duplicação:** matrícula usa upsert lógico respeitando o unique `(turma_id, aluno_id)`.
- **Validação de plano vinculável** (OFICIAL + publicado) é invariante de negócio no **service**, refletida como `422` com `details` (ver [api-conventions](../../01-arquitetura/api-conventions.md#6-validação)).
- **Soft delete** para turma e matrícula; `TurmaPlano` pode ser hard delete no desvínculo (relação de junção), retornando `204`.
- **Fase 2 (Hotmart):** matrículas podem ser criadas automaticamente pelo webhook mapeando `produto_hotmart`→turma; o mesmo modelo `Matricula` é reutilizado (ver [integracao-hotmart](../integracao-hotmart/design.md)).

# Plano de Estudo — Design

**Fase: [MVP]**

Referência de requisitos: [requirements.md](requirements.md). Convenções obrigatórias: [api-conventions.md](../../01-arquitetura/api-conventions.md).

## Entidades envolvidas

Todas definidas na fonte única [data-model.md](../../01-arquitetura/data-model.md):

- **[Plano](../../01-arquitetura/data-model.md#plano)** — `tipo` (`OFICIAL` | `PESSOAL`), `autor_id`, `plano_origem_id?`, `publicado`.
- **[Disciplina](../../01-arquitetura/data-model.md#disciplina)** — `plano_id`, `nome`, `ordem`.
- **[Tema](../../01-arquitetura/data-model.md#tema)** — `disciplina_id`, `nome`, `ordem`.
- **[Subtema](../../01-arquitetura/data-model.md#subtema)** — `tema_id`, `nome`, `ordem`, `duracao_estimada_min?`.
- **[PesoDisciplina](../../01-arquitetura/data-model.md#pesodisciplina)** — `plano_id`, `disciplina_id`, `peso_percentual`; unique `(plano_id, disciplina_id)`; invariante Σ = 100.
- **[User](../../01-arquitetura/data-model.md#user)** — autor/autorização (interno vs `ALUNO`).

> Nenhuma entidade nova é introduzida. `TurmaPlano` (vínculo de plano OFICIAL a turma) é tratada em [turmas/design.md](../turmas/design.md).

## Endpoints REST

Prefixo `/api/v1`. JSON `camelCase`. Erros no envelope padrão. Autorização por role/escopo.

### Planos

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| GET | `/planos` | Lista planos. Filtros: `?tipo=OFICIAL\|PESSOAL`, `?publicado=true`, `?autorId=`. Aluno vê OFICIAIS publicados + seus PESSOAIS. | Autenticado |
| GET | `/planos/{id}` | Obtém plano com árvore (disciplinas→temas→subtemas) e pesos. | Autor / interno / aluno se OFICIAL publicado |
| POST | `/planos` | Cria plano. Interno → pode `tipo=OFICIAL`; aluno → só `tipo=PESSOAL`. | Autenticado (role decide `tipo`) |
| PATCH | `/planos/{id}` | Atualiza `titulo`/`descricao`. `tipo` imutável. | Autor / interno |
| DELETE | `/planos/{id}` | Remove plano (cascade soft delete). | Autor / interno |
| POST | `/planos/{id}/publicar` | Publica OFICIAL: valida Σ pesos = 100 e ≥1 disciplina. | Interno |
| POST | `/planos/{id}/derivar` | **Deriva plano PESSOAL a partir de um OFICIAL publicado** (cópia). | `ALUNO` |

**POST `/planos` (request):**
```json
{ "titulo": "Analista TRF", "descricao": "...", "tipo": "OFICIAL" }
```
**Response `201`:** recurso `Plano` criado.

**POST `/planos/{id}/derivar` (request):** corpo vazio ou `{ "titulo": "Meu plano" }` (opcional; default = título do oficial + " (pessoal)").
**Response `201`:** novo `Plano` PESSOAL com `planoOrigemId`, `autorId` = aluno, e árvore/pesos copiados. Erros: `404` (oficial inexistente), `422` (não publicado / não é OFICIAL).

### Disciplinas (aninhado ao plano)

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| GET | `/planos/{planoId}/disciplinas` | Lista disciplinas do plano (com temas/subtemas). | Leitura do plano |
| POST | `/planos/{planoId}/disciplinas` | Cria disciplina. Body: `{ nome, ordem }`. | Autor / interno |
| PATCH | `/disciplinas/{id}` | Atualiza `nome`/`ordem`. | Autor / interno |
| DELETE | `/disciplinas/{id}` | Remove disciplina (cascade em temas/subtemas + peso). | Autor / interno |

### Temas e Subtemas

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| GET | `/disciplinas/{disciplinaId}/temas` | Lista temas. | Leitura do plano |
| POST | `/disciplinas/{disciplinaId}/temas` | Cria tema. Body: `{ nome, ordem }`. | Autor / interno |
| PATCH | `/temas/{id}` · DELETE `/temas/{id}` | Atualiza/remove tema. | Autor / interno |
| GET | `/temas/{temaId}/subtemas` | Lista subtemas. | Leitura do plano |
| POST | `/temas/{temaId}/subtemas` | Cria subtema. Body: `{ nome, ordem, duracaoEstimadaMin? }`. | Autor / interno |
| PATCH | `/subtemas/{id}` · DELETE `/subtemas/{id}` | Atualiza/remove subtema. | Autor / interno |

### Pesos das disciplinas

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| PUT | `/planos/{planoId}/pesos` | **Substitui** o conjunto de pesos do plano de uma vez (garante validação atômica Σ = 100). | Autor / interno |
| GET | `/planos/{planoId}/pesos` | Lista pesos atuais. | Leitura do plano |

**PUT `/planos/{planoId}/pesos` (request):**
```json
{ "pesos": [
  { "disciplinaId": "uuid-a", "pesoPercentual": 40.00 },
  { "disciplinaId": "uuid-b", "pesoPercentual": 60.00 }
] }
```
**Response `200`:** lista de `PesoDisciplina`. Erro `422` se `Σ ≠ 100`:
```json
{ "error": { "code": "VALIDATION_ERROR",
  "message": "A soma dos pesos deve ser 100.",
  "details": [ { "field": "pesoPercentual", "issue": "soma deve ser 100" } ] } }
```

## Fluxos

### Fluxo A — Criação e publicação de plano OFICIAL (interno)

1. Interno `POST /planos` (`tipo=OFICIAL`) → cria `Plano` (`publicado=false`).
2. Adiciona Disciplinas (`POST /planos/{id}/disciplinas`), Temas e Subtemas.
3. Define pesos (`PUT /planos/{id}/pesos`) — service valida Σ = 100.
4. `POST /planos/{id}/publicar` → service revalida (pesos = 100, ≥1 disciplina) e seta `publicado=true`.
5. Vínculo a turmas via `TurmaPlano` (ver [turmas](../turmas/design.md)).

### Fluxo B — Derivar plano PESSOAL a partir do OFICIAL (aluno) — explícito

```
Aluno                          API / Service                        DB
  │  POST /planos/{oficialId}/derivar                                │
  ├─────────────────────────────►│                                  │
  │                              │ 1. carrega OFICIAL + árvore       │
  │                              │    (disciplinas, temas, subtemas, │
  │                              │     pesos)                        │
  │                              │ 2. valida: existe? tipo=OFICIAL?  │
  │                              │    publicado=true? senão 404/422  │
  │                              │ 3. BEGIN TX                       │
  │                              │ 4. cria Plano PESSOAL             │
  │                              │    (autor_id=aluno,               │
  │                              │     plano_origem_id=oficialId,    │
  │                              │     tipo=PESSOAL)                 │
  │                              │ 5. copia Disciplinas → novo id;   │
  │                              │    mapa origem→cópia              │
  │                              │ 6. copia Temas (remapeando        │
  │                              │    disciplina_id via mapa)        │
  │                              │ 7. copia Subtemas (remapeando     │
  │                              │    tema_id)                       │
  │                              │ 8. copia PesosDisciplina          │
  │                              │    (remapeando disciplina_id)     │
  │                              │ 9. COMMIT                         │
  │  201 { Plano PESSOAL }        │                                  │
  │◄─────────────────────────────┤                                  │
```

Pós-condições: o plano PESSOAL tem árvore idêntica em conteúdo mas com **ids próprios**; `Σ pesos copiados = 100` (idêntico ao oficial). A partir daí, edições no PESSOAL são independentes do OFICIAL (RN-04).

### Fluxo C — Edição de conteúdo

CRUD de Disciplina/Tema/Subtema restrito ao autor (PESSOAL) ou interno (OFICIAL). Alterações em pesos sempre via `PUT /planos/{id}/pesos` para manter a validação atômica de Σ = 100.

## Decisões técnicas

- **DT-01 — Cópia dentro de transação.** A derivação (Fluxo B) roda em uma única transação; falha em qualquer passo faz rollback (nenhum plano parcial). Um **mapa origem→cópia** em memória remapeia as FKs (`disciplina_id`, `tema_id`, `disciplina_id` do peso) para os ids recém-criados.
- **DT-02 — Validação de pesos no service.** A invariante Σ = 100 é validada no service (conforme [api-conventions §6](../../01-arquitetura/api-conventions.md#6-validação)), nunca só via constraint de banco. Substituição de pesos é feita por `PUT` (replace-all) para evitar estados intermediários inválidos.
- **DT-03 — `plano_origem_id` é rastreabilidade, não sincronização.** Não há atualização automática do PESSOAL quando o OFICIAL muda (fora do MVP).
- **DT-04 — Autorização em duas camadas.** Guard por role (interno vs `ALUNO`) + verificação de propriedade (`autor_id`) no service; acesso cruzado → `403` ([api-conventions §3](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)).
- **DT-05 — Cascade.** FK `ON DELETE CASCADE` de Plano→Disciplina→Tema→Subtema e Plano→PesoDisciplina (ver [data-model §8](../../01-arquitetura/data-model.md#8-índices-e-integridade-destaques)), com soft delete conforme convenção global.
- **DT-06 — `tipo` imutável.** Não há endpoint que altere `tipo`; PATCH ignora o campo.

## Dependências

- [requirements.md](requirements.md) · [tasks.md](tasks.md)
- [data-model.md](../../01-arquitetura/data-model.md) · [api-conventions.md](../../01-arquitetura/api-conventions.md)
- [progresso](../progresso/design.md) · [cronograma-e-calendario](../cronograma-e-calendario/design.md) · [turmas](../turmas/design.md)

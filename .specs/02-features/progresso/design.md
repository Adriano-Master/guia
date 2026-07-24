# Progresso — Design

**Fase: [MVP]**

Referência de requisitos: [requirements.md](requirements.md). Convenções: [api-conventions.md](../../01-arquitetura/api-conventions.md).

## Entidades envolvidas

Definidas na fonte única [data-model.md](../../01-arquitetura/data-model.md):

- **[ProgressoSubtema](../../01-arquitetura/data-model.md#progressosubtema)** — `aluno_id`, `subtema_id`, `concluido`, `concluido_em?`; unique `(aluno_id, subtema_id)`. **Único registro persistido** desta feature.
- **[Subtema](../../01-arquitetura/data-model.md#subtema)** — unidade de conclusão; pertence a Tema.
- **[Tema](../../01-arquitetura/data-model.md#tema)** — agrega subtemas; pertence a Disciplina.
- **[Disciplina](../../01-arquitetura/data-model.md#disciplina)** — agrega temas; pertence a Plano.
- **[Plano](../../01-arquitetura/data-model.md#plano)** — raiz da agregação.
- **[User](../../01-arquitetura/data-model.md#user)** — `aluno_id` para escopo/autorização.

> O progresso de Tema/Disciplina/Plano é **calculado**, não persistido. Nenhuma entidade nova.

## Cálculo do percentual

O progresso em qualquer nível é a razão de **subtemas concluídos** sobre **subtemas totais** naquele nó, ×100. Contagem simples (não ponderada por `PesoDisciplina` — RN-02).

- **Subtema** — binário: `concluido ∈ {true, false}` → 100% ou 0%.
- **Tema** — `progresso(tema) = concluídos(tema) / total(tema) × 100`, onde `total(tema)` = subtemas ativos do tema; `concluídos(tema)` = subtemas do tema com `ProgressoSubtema.concluido=true` para o aluno.
- **Disciplina** — `progresso(disc) = concluídos(disc) / total(disc) × 100`, somando sobre **todos os subtemas de todos os temas** da disciplina (equivalente a somar numeradores e denominadores dos temas).
- **Plano** — `progresso(plano) = concluídos(plano) / total(plano) × 100`, sobre **todos os subtemas do plano**.

**Importante:** níveis superiores agregam pela **contagem de subtemas folha**, não pela média dos percentuais dos filhos. Ex.: Tema A (1 subtema, 100%) + Tema B (3 subtemas, 0%) → disciplina = 1/4 = **25%** (não a média 50%).

**Divisão por zero:** se `total = 0`, o progresso é `0%` (CA-07, CB-01).

**Exemplo:**
```
Plano
 └ Português (disciplina)
    ├ Colocação pronominal (tema)   subtemas: [Próclise✓, Mesóclise✗, Ênclise✓]
    └ Crase (tema)                  subtemas: [Regra geral✓]
Tema "Colocação pronominal" = 2/3 = 66,67%
Tema "Crase"                = 1/1 = 100%
Disciplina "Português"      = 3/4 = 75%
Plano (só Português)        = 3/4 = 75%
```

## Endpoints REST

Prefixo `/api/v1`. JSON `camelCase`. Todos escopados ao aluno autenticado; acesso cruzado → `403` ([api-conventions §3](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)).

### Marcar / desmarcar conclusão de subtema

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| PUT | `/progresso/subtemas/{subtemaId}` | Define conclusão do subtema para o aluno autenticado (upsert). | `ALUNO` (dono) |

**Request:**
```json
{ "concluido": true }
```
**Response `200`:**
```json
{ "subtemaId": "uuid", "concluido": true, "concluidoEm": "2026-07-06T13:00:00Z" }
```
Erros: `404` (subtema inexistente — CA-09), `403` (fora do escopo do aluno). Idempotente (CA-03, RN-05).

### Consultar progresso agregado do plano

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| GET | `/progresso/planos/{planoId}` | Retorna a árvore do plano com percentuais em cada nível para o aluno autenticado. | `ALUNO` (dono) |

**Response `200` (resumido):**
```json
{
  "planoId": "uuid",
  "progressoPercentual": 75.00,
  "subtemasConcluidos": 3,
  "subtemasTotais": 4,
  "disciplinas": [
    { "disciplinaId": "uuid", "progressoPercentual": 75.00,
      "concluidos": 3, "totais": 4,
      "temas": [
        { "temaId": "uuid", "progressoPercentual": 66.67, "concluidos": 2, "totais": 3,
          "subtemas": [ { "subtemaId": "uuid", "nome": "Próclise", "concluido": true } ] }
      ] }
  ]
}
```

### Listar estado de subtemas

| Método | Caminho | Descrição | Autorização |
|---|---|---|---|
| GET | `/progresso/subtemas?planoId={planoId}` | Lista subtemas do plano com flag `concluido` do aluno. Filtros: `?temaId=`, `?concluido=false` (ex.: "o que falta"). | `ALUNO` (dono) |

## Fluxos

### Fluxo A — Marcar subtema como concluído

1. Aluno `PUT /progresso/subtemas/{id}` com `{ concluido: true }`.
2. Service valida existência do subtema (`404` se não) e escopo do aluno.
3. Upsert em `ProgressoSubtema` por `(aluno_id, subtema_id)`: se novo, cria com `concluido_em=agora`; se já `concluido=true`, mantém `concluido_em` (CB-05); se passa a `false`, zera `concluido_em`.
4. Retorna estado atualizado (`200`).

### Fluxo B — Consultar progresso agregado

1. Aluno `GET /progresso/planos/{planoId}`.
2. Service carrega a árvore do plano (Disciplinas→Temas→Subtemas ativos) e os `ProgressoSubtema` do aluno para os subtemas do plano.
3. Agrega bottom-up contando subtemas folha (fórmula acima) e calcula percentuais por tema, disciplina e plano.
4. Retorna a árvore com percentuais.

## Decisões técnicas

- **DT-01 — Progresso derivado, não materializado (MVP).** Percentuais calculados sob demanda por query agregada, garantindo consistência imediata com marcações (CA-10, CB-03). Materialização/cache fica para otimização futura.
- **DT-02 — Agregação por folhas.** A soma é sempre sobre subtemas folha (numerador/denominador acumulados), evitando o erro de média-de-médias.
- **DT-03 — Cálculo eficiente.** Uma query agrupada por tema/disciplina retorna `count(*)` (total) e `count(*) filter (where concluido)` (concluídos) por nó, resolvendo todos os níveis em uma passada; índice em `ProgressoSubtema(aluno_id, subtema_id)` (ver [data-model §8](../../01-arquitetura/data-model.md#8-índices-e-integridade-destaques)).
- **DT-04 — Upsert idempotente.** `PUT` com chave `(aluno_id, subtema_id)`; `concluido_em` só é setado na transição para `true` e preservado em remarcações (CB-05).
- **DT-05 — Escopo por aluno.** Guard + service garantem que só o dono lê/altera seu progresso; nunca há acesso a progresso de terceiros (`403`).
- **DT-06 — Sem ponderação por peso.** `PesoDisciplina` é ignorado no progresso (RN-02); ponderação por peso, se desejada, seria uma métrica separada em [estatisticas](../estatisticas/design.md).

## Dependências

- [requirements.md](requirements.md) · [tasks.md](tasks.md)
- [data-model.md](../../01-arquitetura/data-model.md) · [api-conventions.md](../../01-arquitetura/api-conventions.md)
- [plano-de-estudo](../plano-de-estudo/design.md) — árvore que fornece o denominador.
- [estatisticas](../estatisticas/design.md) — consome métricas de conclusão.

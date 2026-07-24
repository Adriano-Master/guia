# Cronograma e Calendário — Design

## Entidades envolvidas

- [Cronograma](../../01-arquitetura/data-model.md#cronograma) — configuração + metadados da geração.
- [BlocoCronograma](../../01-arquitetura/data-model.md#blococronograma) — cada slot resultante.
- [PesoDisciplina](../../01-arquitetura/data-model.md#pesodisciplina), [Disciplina](../../01-arquitetura/data-model.md#disciplina), [Subtema](../../01-arquitetura/data-model.md#subtema), [ProgressoSubtema](../../01-arquitetura/data-model.md#progressosubtema).

## Endpoints REST (`/api/v1`, JWT, escopados ao aluno)

| Método | Caminho | Descrição |
|---|---|---|
| POST | `/cronogramas` | Gera (ou regenera) o cronograma ativo. Body: `{ planoId, diasSemana, janelas, granularidadeMin, timezone }`. Retorna `201` com o cronograma + blocos. |
| GET | `/cronogramas/ativo` | Cronograma ativo do aluno. |
| GET | `/cronogramas/{id}/blocos?from=&to=` | Blocos no intervalo (para a tela de calendário). |
| PATCH | `/blocos/{id}` | Atualiza status do bloco: `{ status: CONCLUIDO \| PULADO \| PLANEJADO }`. |
| POST | `/cronogramas/{id}/rebalancear` | **[Fase 2]** recalcula blocos futuros a partir de hoje considerando atrasos. |

Validações (`422`): janela < granularidade; Σ pesos ≠ 100; plano sem disciplinas; `diasSemana` vazio.

## Algoritmo de distribuição (núcleo)

Executado no **service** (`CronogramaService.gerar`), determinístico e testável.

### Passo 1 — Enumerar slots disponíveis na semana
Para cada dia em `diasSemana`, para cada janela do dia, fatiar em slots de `granularidadeMin`.
- `slotsTotais = Σ (duração_janela / granularidade)` (arredondando o resto para o último slot).
- `minutosTotais = Σ durações das janelas`.

### Passo 2 — Alocar minutos por disciplina (proporcional aos pesos)
Para cada disciplina `d` com peso `p_d`:
```
minutos_d = round( p_d/100 × minutosTotais )
```
Corrigir o erro de arredondamento (método do **maior resto / largest remainder**) para que `Σ minutos_d = minutosTotais` exatamente:
1. Calcule `bruto_d = p_d/100 × minutosTotais`.
2. `base_d = floor(bruto_d / granularidade) × granularidade` (múltiplos de slot).
3. Some as `base_d`; a diferença que falta para `minutosTotais` é distribuída, 1 slot por vez, às disciplinas com maior resto fracionário `(bruto_d − base_d)`.
4. **Mínimo:** disciplina com `p_d > 0` recebe ≥ 1 slot se sobrar espaço.

Converta em slots: `slots_d = minutos_d / granularidade`.

### Passo 3 — Sequenciar as disciplinas nos slots (round-robin ponderado)
Objetivo: espalhar cada disciplina ao longo da semana em vez de amontoar.
- Monte uma fila ordenando os slots por (dia, horário).
- Use **maior resto incremental** por disciplina para escolher, a cada slot, a disciplina cujo "débito" acumulado é maior:
```
para cada slot na ordem cronológica:
    para cada disciplina d: credito_d += slots_d / slotsTotais
    escolha d* = disciplina com maior credito_d e slots restantes > 0
    atribua o slot a d*; credito_d* -= 1; slots_d*--
```
Isso produz uma intercalação proporcional (ex.: peso alto aparece mais vezes, distribuído).

### Passo 4 — Agrupar slots contíguos da mesma disciplina em um bloco
Slots consecutivos (mesmo dia, horário contínuo) da mesma disciplina viram **um** `BlocoCronograma` com `inicio`/`fim`/`duracao_min`.

### Passo 5 — Atribuir subtema a cada bloco
Para a disciplina do bloco, buscar o próximo `Subtema` não concluído (menor `ordem`, via `ProgressoSubtema`). Preencher `subtema_id`. Se não houver pendente, deixar nulo (bloco de revisão).

### Passo 6 — Persistir
Desativar cronograma anterior (`ativo=false`), criar novo `Cronograma` + `BlocoCronograma[]` em transação. Datas em UTC (converter das janelas locais + timezone).

## Exemplo numérico (caso de teste da spec)

**Plano:** 4 disciplinas — Português 30%, Matemática 20%, Informática 20%, Direito 30%.
**Disponibilidade:** seg/qua/sex, janelas 08:00–10:00 e 14:00–16:00 = 4h/dia × 3 dias = **12h/semana = 720 min**. Granularidade **60 min** → **12 slots**.

Passo 2 (minutos/slots por disciplina):
| Disciplina | Peso | Minutos (720×p) | Slots |
|---|---|---|---|
| Português | 30% | 216 → **240** (4 slots) | 4 |
| Direito | 30% | 216 → **240** (4 slots) | 4 |
| Matemática | 20% | 144 → **120** (2 slots) | 2 |
| Informática | 20% | 144 → **120** (2 slots) | 2 |
| **Total** | 100% | **720** | **12** ✔ |

> Nota: 30% de 12 slots = 3,6 e 20% = 2,4. Pelo largest remainder com base em slots: bases = [3,3,2,2]=10 slots; faltam 2 slots → vão para os 2 maiores restos (Português 0,6 e Direito 0,6) → [4,4,2,2]. Soma = 12 ✔ e a proporção fica o mais fiel possível à granularidade escolhida.

Passo 3 (round-robin ponderado sobre 12 slots cronológicos — seg 8–9, 9–10, 14–15, 15–16, qua…, sex…): produz intercalação como
```
Seg: Português, Direito, Matemática, Português
Qua: Direito, Português, Informática, Direito
Sex: Português(rev)/Direito, Matemática, Informática, Direito
```
(a ordem exata depende do desempate; o invariante testável é a **contagem**: Português 4, Direito 4, Matemática 2, Informática 2, total 12).

Passo 5: cada slot de Português recebe o próximo subtema não concluído (ex.: "Colocação pronominal › Mesóclise").

**Verificação:** 4+4+2+2 = 12 slots × 60 min = 720 min = 12h ✔ (bate com a disponibilidade informada).

## Decisões técnicas

- **Determinismo:** dado o mesmo input e estado de progresso, a geração é reproduzível (sem aleatoriedade) — facilita teste.
- **Idempotência de regeração:** POST `/cronogramas` sempre substitui o ativo.
- **Fuso (ADR-03):** janelas informadas em horário local + `timezone`; persistir `inicio/fim` em UTC.
- **Recorrência:** o padrão semanal é um "template"; blocos são materializados por semana sob demanda no GET por intervalo (evita explodir a tabela). Alternativa mais simples no MVP: materializar N semanas à frente (ex.: 4). Escolha documentada como ADR na implementação.
- **[Fase 2] Rebalanceamento:** ao chamar `/rebalancear`, blocos `PLANEJADO` passados viram `PULADO`; o débito de subtemas não concluídos é reinjetado nas próximas semanas mantendo os pesos.

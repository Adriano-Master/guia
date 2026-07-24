# Questões e Desempenho — Requisitos

**Fase:**
- **[MVP]** — Registro de questões resolvidas e erros por tema (opcionalmente subtema), com cálculo de taxa de erro.
- **[Fase 2]** — Recomendação de estudo baseada em alta taxa de erro (bônus do item 6 da visão; ver [visão §5](../../00-visao-produto.md#5-escopo-por-fase)).

## Objetivo

Permitir que o aluno **registre quantas questões resolveu e quantas errou** em um determinado [`Tema`](../../01-arquitetura/data-model.md#tema) (opcionalmente um [`Subtema`](../../01-arquitetura/data-model.md#subtema)) numa **data**, gerando uma [`RegistroQuestoes`](../../01-arquitetura/data-model.md#registroquestoes). A partir desses registros calcula-se a **taxa de erro** (`erros/total`), insumo para estatísticas e, na **[Fase 2]**, para **recomendar** ao aluno estudar mais os temas com desempenho ruim.

## User stories

### [MVP]
- **US-1** — Como aluno, quero **registrar** o total de questões resolvidas e os erros num tema (e opcionalmente subtema) numa data, para acompanhar meu desempenho.
- **US-2** — Como aluno, quero **listar e filtrar** meus registros por tema e período, para revisar minha evolução.
- **US-3** — Como aluno, quero **editar/excluir** um registro que lancei errado, para manter os dados corretos.
- **US-4** — Como aluno, quero ver a **taxa de erro** de cada registro e agregada por tema, para saber onde erro mais.

### [Fase 2]
- **US-5** — Como aluno, quero **receber recomendações** dos temas em que devo estudar mais, priorizados por taxa de erro, para focar meu tempo no que rende mais.

## Critérios de aceitação (testáveis)

### [MVP]
- **CA-1** — Ao registrar `total ≥ 1` e `0 ≤ erros ≤ total` para um `temaId` válido e `data ≤ hoje`, a API cria a `RegistroQuestoes` e responde `201`.
- **CA-2** — `erros > total` responde `422 VALIDATION_ERROR` com `details` apontando `erros`.
- **CA-3** — `total < 1`, `erros < 0`, `data` no futuro, ou `temaId` inexistente respondem `422 VALIDATION_ERROR`.
- **CA-4** — Se `subtemaId` for informado, ele DEVE pertencer ao `temaId` informado; caso contrário `422 VALIDATION_ERROR`.
- **CA-5** — A resposta inclui o campo **derivado** `taxaErro = erros/total` (0..1), **não** persistido no banco.
- **CA-6** — `GET /questoes` retorna apenas registros do aluno autenticado, paginado, com filtros `temaId`, `subtemaId`, `from`, `to` e ordenação por `-data` (default).
- **CA-7** — Registros de outro aluno nunca são acessíveis: acesso cruzado → `403 FORBIDDEN` (ou `404`).
- **CA-8** — `GET /questoes/desempenho` retorna, por tema, o agregado `totalQuestoes`, `totalErros` e `taxaErro` no período filtrado.

### [Fase 2]
- **CA-9** — `GET /questoes/recomendacoes` retorna a lista de temas recomendados (ordenados por `taxaErro` desc), considerando **apenas** temas com `totalQuestoes ≥ N_MIN` e `taxaErro ≥ LIMIAR` no período (ver fórmula no [design](design.md#fórmula-da-recomendação-fase-2)).
- **CA-10** — Temas com amostra insuficiente (`totalQuestoes < N_MIN`) **não** aparecem nas recomendações, mesmo com taxa de erro alta.
- **CA-11** — Quando nenhum tema atende aos limiares, a resposta é `200` com lista vazia.

## Regras de negócio

### [MVP]
- **RN-1 (escopo por aluno)** — Todo `RegistroQuestoes` pertence ao `aluno_id` autenticado; sem acesso cruzado.
- **RN-2 (invariante erros≤total)** — Sempre `0 ≤ erros ≤ total` e `total ≥ 1`, validado no service (`422`).
- **RN-3 (taxa derivada)** — `taxa_erro = erros/total` é **calculada**, nunca armazenada (conforme [data-model](../../01-arquitetura/data-model.md#registroquestoes)).
- **RN-4 (tema/subtema coerentes)** — `subtemaId` (opcional) DEVE ser filho do `temaId`.
- **RN-5 (múltiplos registros por dia)** — É permitido mais de um registro para o mesmo tema/data (sessões diferentes); agregações somam `total` e `erros`.

### [Fase 2]
- **RN-6 (elegibilidade da recomendação)** — Um tema só é recomendável se, no período analisado, `totalQuestoes ≥ N_MIN` (amostra mínima) **e** `taxaErro ≥ LIMIAR`.
- **RN-7 (ordenação)** — Recomendações ordenadas por `taxaErro` desc; empate desempatado por maior `totalErros`.
- **RN-8 (parâmetros configuráveis)** — `N_MIN` e `LIMIAR` têm defaults (ver design) e podem ser sobrepostos por query params dentro de faixas válidas.

## Casos de borda

- **CB-1** — `total = 0` não é permitido (divisão por zero na taxa) → `422`.
- **CB-2** — `erros = total` → `taxaErro = 1.0` (100%); registro válido.
- **CB-3** — Período de agregação sem registros → agregados zerados / listas vazias, `200`.
- **CB-4** — `subtemaId`/`temaId` referenciando entidade inexistente → `422`.
- **CB-5 [Fase 2]** — Tema com `taxaErro` altíssima mas `totalQuestoes < N_MIN` → excluído das recomendações (CA-10).
- **CB-6 [Fase 2]** — `LIMIAR`/`N_MIN` fora da faixa válida na query → `422`.

## Dependências

- [Modelo de dados — RegistroQuestoes](../../01-arquitetura/data-model.md#registroquestoes), [Tema](../../01-arquitetura/data-model.md#tema), [Subtema](../../01-arquitetura/data-model.md#subtema)
- [Convenções de API](../../01-arquitetura/api-conventions.md)
- [Plano de estudo](../plano-de-estudo/requirements.md) (origem de temas/subtemas)
- [Estatísticas](../estatisticas/requirements.md) (consome desempenho agregado)
- [Autenticação e usuários](../auth-e-usuarios/requirements.md) (escopo/roles)

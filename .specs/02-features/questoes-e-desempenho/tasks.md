# Questões e Desempenho — Tasks

**Fase:** itens **[MVP]** e **[Fase 2]** marcados.

## Backend

- [x] **[MVP]** Criar módulo `questoes` (controller, service, repository, DTOs) espelhando [overview §3](../../01-arquitetura/overview.md#3-organização-de-pastas-proposta).
- [x] **[MVP]** Mapear model `RegistroQuestoes` no ORM conforme [data-model](../../01-arquitetura/data-model.md#registroquestoes) (sem coluna `taxa_erro`).
- [x] **[MVP]** Migration: índice `RegistroQuestoes(aluno_id, tema_id, data)`. (+ CHECK `total≥1 AND 0≤erros≤total` no banco, defesa em profundidade do review.)
- [x] **[MVP]** DTOs + validação: `CreateRegistroDto` (`total≥1`, `0≤erros≤total`, `data≤hoje`), `UpdateRegistroDto`, filtros de listagem/desempenho. (Null explícito tratado: `subtemaId:null` = sem subtema; `total/erros/data:null` → 422 — correção de review que também consertou o mesmo padrão em sessões.)
- [x] **[MVP]** Guard role `ALUNO` + escopo por `aluno_id` (acesso cruzado → 403). (Tema legível via regra provisória de planos, igual sessões/progresso.)
- [x] **[MVP]** `POST /questoes` — validar invariantes e coerência tema/subtema; retornar `taxaErro` derivado (RN-2, RN-3, RN-4, CA-1..CA-5). (taxaErro 4 casas; respostas incluem `temaNome`/`subtemaNome`.)
- [x] **[MVP]** `GET /questoes` — paginação, filtros `temaId/subtemaId/from/to`, `sort=-data` default (CA-6). (from/to inclusivos em campo DATE; ordenação com desempate estável — correção de review aplicada a todas as listagens do projeto.)
- [x] **[MVP]** `GET /questoes/{id}`, `PATCH /questoes/{id}`, `DELETE /questoes/{id}` escopados ao aluno (CA-7). (PATCH inclui `data` — extensão consciente; revalidação cruzada com valores resultantes.)
- [x] **[MVP]** `GET /questoes/desempenho` — agregação `SUM(total)/SUM(erros)` por tema, `taxaErro` com divisão segura, período default 30 dias (CA-8, D-3, D-5). (Inclui `temaNome`; ordenado por taxa desc; from/to efetivos ecoados.)
- [ ] **[Fase 2]** `GET /questoes/recomendacoes` — reusar agregação, aplicar filtros `totalQuestoes≥N_MIN` e `taxaErro≥LIMIAR`, ordenação e `motivo` (CA-9..CA-11, RN-6, RN-7).
- [ ] **[Fase 2]** Configuração de `N_MIN`/`LIMIAR` (defaults 20 / 0,50) sobreponíveis por query com validação de faixa (RN-8, CB-6).
- [x] **[MVP]** Integrar filtro global de erros ([envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão)).

## Frontend (Angular)

- [x] **[MVP]** Criar feature `questoes` em `/src/app/features`, rota protegida por guard de auth. (+ link "Questões" na sidebar para ALUNO.)
- [x] **[MVP]** `QuestoesService` (HTTP): create/list/get/update/delete + desempenho.
- [x] **[MVP]** Formulário de registro (tema, subtema opcional, data, total, erros) com validação `erros≤total`, `total≥1`, `data≤hoje`; exibir `taxaErro` calculada ao vivo.
- [x] **[MVP]** Seletor de tema/subtema populado do plano ativo do aluno. (Seleção manual de plano, padrão vigente — `AlunoPlanoAtivo` ainda não existe.)
- [x] **[MVP]** Lista/histórico de registros com paginação e filtros (tema, período) e ações editar/excluir. (Edição inline com validação ao vivo e a11y; nomes de tema/subtema vindos do payload.)
- [x] **[MVP]** Painel de desempenho por tema (taxa de erro agregada) — consome `GET /questoes/desempenho`. (Thresholds de cor 25/50% com valor sempre em texto; período efetivo exibido.)
- [ ] **[Fase 2]** `RecomendacoesService` + tela de recomendações (temas ordenados por taxa de erro, com `motivo`); estado vazio quando nada atende aos limiares.
- [x] **[MVP]** Tratamento de erros 422/403/404 com mensagens ao usuário.

## Testes

- [x] **[MVP]** Unit (service): invariante `0≤erros≤total`, `total≥1`, data futura → 422 (RN-2, CA-2, CA-3, CB-1).
- [x] **[MVP]** Unit (service): cálculo de `taxaErro` incluindo `erros=total` → 1.0 (CA-5, CB-2).
- [x] **[MVP]** Unit (service): coerência subtema↔tema (RN-4, CA-4, CB-4).
- [x] **[MVP]** Unit (service): agregação de desempenho com período vazio → zeros (CA-8, CB-3).
- [ ] **[Fase 2]** Unit (service): recomendação — inclui tema elegível, exclui amostra insuficiente, ordena por taxa e desempata por erros (CA-9, CA-10, RN-6, RN-7, CB-5).
- [ ] **[Fase 2]** Unit (service): `N_MIN`/`LIMIAR` fora da faixa → 422; lista vazia quando nada atende (CA-11, CB-6).
- [x] **[MVP]** Integração (e2e API): CRUD de registro; escopo por aluno → 403/404 (CA-7). (+ regressões: null explícito, paginação estável com desempate, CHECK do banco.)
- [x] **[MVP]** Integração: `GET /questoes` e `/questoes/desempenho` filtros/paginação/período (CA-6, CA-8).
- [ ] **[Fase 2]** Integração: `GET /questoes/recomendacoes` com dados de fixture cobrindo limiares.
- [x] **[MVP]** Frontend: testes do formulário (validações) e do painel de desempenho. (49 testes vitest na feature.)

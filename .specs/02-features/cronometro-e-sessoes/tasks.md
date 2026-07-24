# Cronômetro e Sessões — Tasks

**Fase:** MVP.

## Backend

- [x] Criar módulo `sessoes` (controller, service, repository, DTOs) espelhando a organização de [overview §3](../../01-arquitetura/overview.md#3-organização-de-pastas-proposta).
- [x] Mapear entidade/model `SessaoEstudo` no ORM conforme [data-model](../../01-arquitetura/data-model.md#sessaoestudo).
- [x] Migration: índice único parcial `unique(aluno_id) where origem='CRONOMETRO' and fim is null` (D-2) e índice `SessaoEstudo(aluno_id, inicio)`.
- [x] DTOs + validação (Zod/class-validator): `StartCronometroDto`, `StopCronometroDto` (`pausaMin`), `ManualSessaoDto` (`duracaoMin>0`, `data<=hoje`), filtros de listagem. (Teto adicional `duracaoMin ≤ 1440` por decisão de review.)
- [x] Guard de role `ALUNO` + escopo por `aluno_id` (bloqueio de acesso cruzado → 403).
- [x] `POST /sessoes/cronometro/start` — verificação transacional `FOR UPDATE` + criação (RN-1, CA-1, CA-2, CB-5).
- [x] `GET /sessoes/ativa` — retorna cronômetro em andamento (reidratação, CB-3). (Sem cronômetro → 404 com envelope, em vez de 204 — consistente com CB-1.)
- [x] `POST /sessoes/ativa/pause` e `/resume` — validar transições, retornar 409 em transição inválida (CA-4). (Estado de pausa em memória no servidor, conforme D-3 — perde-se em restart; ver ADR no service.)
- [x] `POST /sessoes/ativa/stop` — calcular `duracao_min` com desconto de `pausaMin` e arredondamento (RN-2, RN-6, D-4, CA-3).
- [x] `DELETE /sessoes/ativa` — descartar sessão em andamento (CA-5, CB-1). (Hard delete deliberado.)
- [x] `POST /sessoes/manual` — criar sessão manual, derivar `inicio`/`fim` (CA-6, CA-7, CB-4).
- [x] Validação de coerência `subtemaId`↔`disciplinaId` (CA-8) e `blocoId`↔aluno/disciplina (CA-9, CB-6).
- [x] `GET /sessoes` — paginação, filtros `disciplinaId/from/to`, `sort=-inicio` default (CA-11).
- [x] `GET /sessoes/{id}`, `PATCH /sessoes/{id}`, `DELETE /sessoes/{id}` escopados ao aluno (RN-7, CA-10). (DELETE de cronômetro em andamento → 409; usar `DELETE /sessoes/ativa`.)
- [x] Integrar filtro global de erros ([envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão)).

## Frontend (Angular)

- [x] Criar feature `sessoes` em `/src/app/features`, com rota protegida por guard de auth.
- [x] `SessaoService` (HTTP) com métodos start/stop/pause/resume/discard/manual/list e reidratação via `GET /sessoes/ativa`.
- [x] Componente **Cronômetro** (standalone + signals): exibir tempo corrente, botões start/pause/resume/stop/descartar; máquina de estados RUNNING/PAUSED/STOPPED.
- [x] Seletor de disciplina e subtema (opcional), populado do plano ativo; suporte a iniciar a partir de um bloco do calendário (`blocoId`). (Botão "iniciar estudo" do calendário ativado, com prefill via query params.)
- [x] Acúmulo local de `pausaMin` e envio no stop (D-3).
- [x] Formulário de **registro manual** (disciplina, subtema opcional, data, minutos) com validação `duracaoMin>0` e `data<=hoje`.
- [x] Tela/histórico de sessões com paginação e filtros (disciplina, período). (Nomes de disciplina/subtema resolvidos via planos carregados na sessão; "—" para não carregados — limitação conhecida.)
- [x] Tratamento de erros: 409 (já há cronômetro rodando), 422 (validação), 403/404, com mensagens ao usuário.
- [x] Persistir estado do cronômetro entre navegações reidratando do servidor (PWA/refresh). (Pausa corrente e acúmulo local se perdem no reload — aproximação conservadora documentada, consequência de D-3.)

## Testes

- [x] Unit (service): unicidade do cronômetro / 409 (RN-1, CA-2, CB-5).
- [x] Unit (service): cálculo de `duracao_min` com e sem pausa e arredondamento (RN-2, RN-6, D-4, CA-3).
- [x] Unit (service): registro manual e derivação de `inicio`/`fim`; rejeição de `duracaoMin≤0` e data futura (CA-6, CA-7, CB-4).
- [x] Unit (service): transições de pausa/resume inválidas → 409 (CA-4).
- [x] Unit (service): validação `subtemaId`↔`disciplinaId` e `blocoId`↔aluno (CA-8, CA-9).
- [x] Integração (e2e API): start→pause→resume→stop feliz; start duplicado → 409; stop sem sessão → 404 (CB-1). (+ rajada de 6 starts simultâneos → um único 201.)
- [x] Integração: escopo por aluno — acesso cruzado → 403/404 (CA-10).
- [x] Integração: `GET /sessoes` filtros/paginação/ordenação (CA-11).
- [x] Frontend: testes de componente do cronômetro (estados) e do formulário manual (validações).

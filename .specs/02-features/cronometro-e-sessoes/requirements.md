# Cronômetro e Sessões — Requisitos

**Fase:** MVP (toda a feature é MVP).

## Objetivo

Permitir que o aluno **registre o tempo estudado por disciplina** (opcionalmente por subtema), de duas formas:

1. **Cronômetro** (origem `CRONOMETRO`): inicia/para um cronômetro em tempo real; ao parar, a `duracao_min` é calculada a partir do intervalo `inicio`→`fim`.
2. **Registro manual** (origem `MANUAL`): o aluno informa diretamente os minutos estudados, sem cronometrar.

Cada registro é uma [`SessaoEstudo`](../../01-arquitetura/data-model.md#sessaoestudo) vinculada ao próprio aluno. A sessão pode, opcionalmente, ligar-se a um [`BlocoCronograma`](../../01-arquitetura/data-model.md#blococronograma) (via `bloco_id`) quando o estudo parte do calendário.

Este registro de tempo alimenta o [progresso](../progresso/requirements.md), as [estatísticas](../estatisticas/requirements.md) e, na Fase 2, a [gamificação](../gamificacao-ranking/requirements.md).

## User stories

- **US-1** — Como aluno, quero **iniciar um cronômetro** para uma disciplina (e opcionalmente um subtema), para medir em tempo real quanto estudei.
- **US-2** — Como aluno, quero **parar o cronômetro** e ter o tempo estudado registrado automaticamente, para não precisar calcular à mão.
- **US-3** — Como aluno, quero **pausar e retomar** o cronômetro, para interrupções curtas não inflarem meu tempo de estudo.
- **US-4** — Como aluno, quero **descartar** um cronômetro em andamento, para o caso de ter iniciado por engano.
- **US-5** — Como aluno, quero **registrar manualmente** minutos estudados numa disciplina, para lançar estudos feitos fora da plataforma.
- **US-6** — Como aluno, quero **listar minhas sessões** filtrando por disciplina e período, para revisar meu histórico.
- **US-7** — Como aluno, quero **iniciar uma sessão a partir de um bloco do meu cronograma**, para o tempo ficar vinculado ao que foi planejado.

## Critérios de aceitação (testáveis)

- **CA-1** — Ao iniciar um cronômetro para uma disciplina válida do plano do aluno, a API cria uma `SessaoEstudo` com `origem = CRONOMETRO`, `inicio` preenchido, `fim = null` e `duracao_min = 0`, respondendo `201`.
- **CA-2** — Se o aluno já possui um cronômetro em andamento (`SessaoEstudo` `CRONOMETRO` com `fim = null`) e tenta iniciar outro, a API responde `409 CONFLICT` com `code = CONFLICT` e **não** cria nova sessão.
- **CA-3** — Ao parar o cronômetro em andamento, `fim` é preenchido e `duracao_min` é calculado como o tempo decorrido **descontando pausas**, arredondado para o minuto inteiro mais próximo (mínimo 1 quando houve tempo > 0); a resposta é `200`.
- **CA-4** — Pausar um cronômetro em andamento registra o instante da pausa; retomar acumula o intervalo pausado para desconto posterior. Pausar uma sessão já pausada, ou retomar uma não pausada, responde `409 CONFLICT`.
- **CA-5** — Descartar um cronômetro em andamento remove a sessão (sem gerar registro de tempo) e responde `204`.
- **CA-6** — Ao registrar manualmente `duracaoMin > 0` para uma disciplina válida, a API cria uma `SessaoEstudo` com `origem = MANUAL`, `inicio`/`fim` coerentes com a data informada e `duracao_min` igual ao valor informado, respondendo `201`.
- **CA-7** — Registro manual com `duracaoMin ≤ 0` ou ausente responde `422 VALIDATION_ERROR`.
- **CA-8** — Se `subtemaId` for informado, ele DEVE pertencer à `disciplinaId` informada; caso contrário `422 VALIDATION_ERROR`.
- **CA-9** — Se `blocoId` for informado, o bloco DEVE pertencer a um cronograma do próprio aluno e sua `disciplina_id` DEVE coincidir com a `disciplinaId` da sessão; caso contrário `422 VALIDATION_ERROR`.
- **CA-10** — Um aluno nunca acessa/opera sessões de outro aluno: qualquer tentativa responde `403 FORBIDDEN` (ou `404` quando o recurso não é dele, conforme filtro global).
- **CA-11** — `GET /sessoes` retorna somente as sessões do aluno autenticado, paginadas, aceitando filtros `disciplinaId`, `from`, `to` e ordenação por `-inicio` (default).

## Regras de negócio

- **RN-1 (unicidade do cronômetro)** — No máximo **um** cronômetro em andamento por aluno em qualquer instante. Andamento = `SessaoEstudo` com `origem = CRONOMETRO` e `fim = null`. Iniciar outro → `409`.
- **RN-2 (cálculo de duração)** — Para `CRONOMETRO`: `duracao_min = round((fim − inicio − tempo_pausado) em minutos)`. Para `MANUAL`: `duracao_min` é o valor informado; `inicio`/`fim` derivam da `data` + `duracaoMin`.
- **RN-3 (escopo por aluno)** — Toda sessão pertence ao `aluno_id` autenticado; não é possível criar/ler/alterar sessão de outro aluno.
- **RN-4 (disciplina válida)** — `disciplinaId` DEVE existir e pertencer a um plano acessível ao aluno (plano ativo do aluno ou plano de turma em que está matriculado).
- **RN-5 (vínculo opcional com bloco)** — `blocoId` é opcional; quando presente segue CA-9. Concluir a sessão **não** altera automaticamente o `status` do bloco (isso é responsabilidade de [progresso](../progresso/requirements.md)/[cronograma](../cronograma-e-calendario/requirements.md)).
- **RN-6 (pausa não conta)** — Tempo em estado pausado é descontado da duração final.
- **RN-7 (imutabilidade pós-registro)** — Uma sessão finalizada (`fim ≠ null`) não pode voltar a rodar; correções são feitas por edição de `duracaoMin` (PATCH) ou exclusão, ambos escopados ao aluno.

## Casos de borda

- **CB-1** — Parar/pausar/retomar/descartar quando **não há** cronômetro em andamento → `404 NOT_FOUND`.
- **CB-2** — Cronômetro esquecido rodando por muito tempo: a duração é calculada normalmente ao parar; não há corte automático no MVP (apenas registrado para análise futura).
- **CB-3** — Perda de conexão do cliente: o servidor é a fonte da verdade; o cliente reidrata o estado consultando `GET /sessoes/ativa`.
- **CB-4** — Data de registro manual no futuro → `422 VALIDATION_ERROR`.
- **CB-5** — Duas requisições de "iniciar" quase simultâneas (corrida): apenas a primeira cria; a segunda recebe `409` (garantido por constraint/transação, ver design).
- **CB-6** — `subtemaId`/`blocoId` referenciando entidade inexistente → `422 VALIDATION_ERROR`.

## Dependências

- [Modelo de dados — SessaoEstudo](../../01-arquitetura/data-model.md#sessaoestudo), [BlocoCronograma](../../01-arquitetura/data-model.md#blococronograma), [Disciplina](../../01-arquitetura/data-model.md#disciplina), [Subtema](../../01-arquitetura/data-model.md#subtema)
- [Convenções de API](../../01-arquitetura/api-conventions.md)
- [Plano de estudo](../plano-de-estudo/requirements.md) (origem de disciplinas/subtemas)
- [Cronograma e calendário](../cronograma-e-calendario/requirements.md) (origem de blocos)
- [Autenticação e usuários](../auth-e-usuarios/requirements.md) (escopo/roles)

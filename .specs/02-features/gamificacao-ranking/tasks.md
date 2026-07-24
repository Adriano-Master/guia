# Gamificação e Ranking — Tarefas

**Fase:** Fase 2 (todos os itens). Ordem: Backend → Frontend Angular → Testes.

## Backend

- [x] Criar módulo `gamificacao` (controller + service + repository + scheduler).
- [x] Migration/entidade `PontuacaoAluno` conforme [data-model](../../01-arquitetura/data-model.md#pontuacaoaluno) (unique `aluno_id`). (Campos exatos do contrato; `horas_estudadas numeric(10,2)`.)
- [x] Config de constantes por env: `PTS_SUBTEMA=10`, `PTS_HORA=5`, `PTS_BONUS_SEM=50`. (+`RANKING_CRON` validado com `IsCronExpression`, `RANKING_CRON_DISABLED`; cron interpretado em UTC no container — documentado no .env.example.)
- [x] Repository: `contarSubtemasConcluidos(alunoId)`. (Set-based p/ o batch: groupBy por aluno.)
- [x] Repository: `somarHoras(alunoId)` (sessões finalizadas) — reutilizar de estatísticas. (Mesmas regras/arredondamento de estatísticas.)
- [x] Repository: `semanasConsistentes(alunoId, tz)` — semanas com ≥ 5 dias distintos de estudo. (`$queryRaw` único com JOIN de cronogramas ativos e `AT TIME ZONE COALESCE(tz,'America/Sao_Paulo')`; semana ISO segunda.)
- [x] Service: `calcularPontuacao(alunoId)` aplicando a fórmula (determinística).
- [x] Service: `recomputarTodos()` com `UPSERT` (`ON CONFLICT (aluno_id)`). (Lote único via `unnest` — atômico; chunking registrado como dívida p/ escala futura.)
- [x] Scheduler cron (`RankingScheduler`) com intervalo configurável. (Execução no boot com delay; guarda de reentrância — achado do review; desabilitável por env nos e2e.)
- [x] Recomputação incremental por aluno (evento/endpoint interno) — opcional. (Atendida como método interno `recomputarAluno`; SEM endpoint público — no-op para INATIVO.)
- [x] Query de ranking com `ROW_NUMBER()` (ordenação + desempate CA-02) e paginação. (+`id asc` como estabilizador final, padrão do projeto; aluno ATIVO sem registro aparece com 0/0/0 no fim, `atualizado_em` nulo por último.)
- [x] Endpoint `GET /api/v1/ranking/global`.
- [x] Endpoint `GET /api/v1/ranking/turmas/{turmaId}` com guard de matrícula ATIVA / professor da turma. (Via `TurmasAccessService` — ADMIN/MODERADOR leem, precedente de turmas; turma inexistente/soft-deleted → 404.)
- [x] Endpoint `GET /api/v1/ranking/me` (posição global + por turma + composição). (Composição DERIVADA do agregado — data-model não tem coluna de bônus/semanas; constantes alteradas por env só refletem após recompute.)
- [x] Filtrar `User.status = ATIVO` (omitir INATIVO — RN-05) em todos os rankings.

## Frontend Angular

- [x] Feature `gamificacao` (standalone components). (Rota lazy `/ranking` p/ ALUNO e PROFESSOR — US-05; página adaptada por papel; link na sidebar p/ ambos.)
- [x] Service HTTP tipado para os endpoints de ranking.
- [x] Tela de ranking com abas Turma / Global. (ALUNO: abas das turmas via `/ranking/me`; PROFESSOR: suas turmas via serviço de turmas + Global, sem card pessoal.)
- [x] Lista paginada com pódio (top 3 destacado) e posição do usuário fixada. (Posição sempre em texto — nunca só cor; badge "Você".)
- [x] Card "minha pontuação" com composição (subtemas, horas, bônus de consistência). (`posicaoGlobal` nulável — aluno recém-INATIVO exibe "—"; achado do review.)
- [x] Seletor de turma (quando o aluno tem várias matrículas).
- [x] Estados de vazio (turma sem alunos) e de carregamento. (403/404 de turma com mensagens amigáveis.)
- [x] Tema claro/escuro (ver [pwa-frontend](../../03-nao-funcionais/pwa-frontend.md)). (Só tokens; `.card--flat` nas linhas.)

## Testes

- [x] Unit: fórmula produz `700` para 30 subtemas / 40h / 4 semanas (exemplo do design).
- [x] Unit: determinismo — mesma entrada → mesmos `pontos` (CA-01).
- [x] Unit: `semanasConsistentes` conta apenas semanas com ≥ 5 dias distintos. (E2E com fixtures 23h locais que falhariam em UTC puro.)
- [x] Unit: ordenação e desempate (pontos → subtemas → atualizado_em) (CA-02).
- [x] Integração: ranking de turma inclui só matrículas ATIVAS (CA-04).
- [x] Integração: `403` sem matrícula ATIVA / não-professor (CA-05).
- [x] Integração: aluno INATIVO omitido do ranking (RN-05). (`PontuacaoAluno` preservado; `/ranking/me` → `posicaoGlobal: null`.)
- [x] Integração: paginação e `posicao` correta entre páginas (CA-03). (+clamp `pageSize` 101→100.)
- [x] Integração: `recomputarTodos()` idempotente e atualiza `atualizado_em` (CA-07). (+reentrância do scheduler e validação de cron inválido no env.)

> Fechamento Fase 2 (2026-07-23): backend 86 testes novos (unit+env) + 19 e2e (suíte total 507/277 verde); frontend 34 specs (suíte 317 verde). **Tensão de spec sinalizada (decisão de produto pendente):** CA-02 quer desempate por "quem chegou à pontuação primeiro" via `atualizado_em asc`, mas CA-07 manda `atualizado_em = now()` em TODA recomputação — no batch todos empatam no timestamp e o desempate degrada para `id asc`; implementado conforme CA-07. Dívidas: chunking do `recomputarTodos` p/ escala futura; UI de professor usa teto de 100 turmas nas abas.

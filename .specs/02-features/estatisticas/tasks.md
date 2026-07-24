# Estatísticas — Tarefas

Ordem: Backend → Frontend Angular → Testes. Itens sem marca = MVP; `[Fase 2]` explícito.

## Backend

- [x] Criar módulo `estatisticas` (controller + service + repository) conforme [overview §3](../../01-arquitetura/overview.md#3-organização-de-pastas-proposta). (Agregações no service via PrismaService, padrão vigente do projeto.)
- [x] DTOs de query (Zod/class-validator): `from`, `to` (ISO-8601), `granularidade`, `agruparPor`, `porDisciplina`. (`porDisciplina` com `@Transform` lendo valor bruto, padrão obrigatório.)
- [x] Guard de escopo: forçar `aluno_id = req.user.id` em todas as consultas. (`@Roles(ALUNO)`; papel interno → 403.)
- [x] Repository: `horasTotais(alunoId, filtro)` — `SUM(duracao_min) WHERE fim IS NOT NULL`.
- [x] Repository: `horasPorDisciplina(alunoId, filtro)` — `GROUP BY disciplina_id`.
- [x] Repository: `serieTemporal(alunoId, granularidade, from, to, tz)` — `date_trunc` no timezone do cronograma ativo. (Teto de intervalo: 366 dias p/ `dia`, 3660 p/ `semana` → 422; achado do review.)
- [x] Service: preenchimento de buckets vazios com `0` (série contínua).
- [x] Repository: `progresso(alunoId)` — numerador (`ProgressoSubtema concluido`) / denominador (subtemas do plano ativo). (Plano ativo PROVISÓRIO = plano do cronograma ativo — `AlunoPlanoAtivo` ainda não existe; trocar quando entrar.)
- [x] Repository: `desempenhoQuestoes(alunoId, agruparPor)` — `SUM(total)`, `SUM(erros)`; `taxaErro` derivada na serialização.
- [x] Endpoint `GET /api/v1/estatisticas/resumo`.
- [x] Endpoint `GET /api/v1/estatisticas/horas-por-disciplina`.
- [x] Endpoint `GET /api/v1/estatisticas/serie-temporal`.
- [x] Endpoint `GET /api/v1/estatisticas/progresso`.
- [x] Endpoint `GET /api/v1/estatisticas/desempenho-questoes`.
- [x] Validação `422` para `from > to`. (Também data de calendário inválida e estouro do teto da série.)
- [ ] [Fase 2] Endpoint `GET /api/v1/estatisticas/comparativo` com checagem de matrícula ATIVA.
- [ ] [Fase 2] Endpoint `GET /api/v1/estatisticas/tendencias` (média móvel + projeção).
- [ ] [Fase 2] Avaliar materialização/cache das agregações se houver gargalo de performance.

## Frontend Angular

- [x] Feature `estatisticas` (standalone components) espelhando o backend. (Rota lazy `/estatisticas` com guard ALUNO + link na sidebar.)
- [x] Service HTTP tipado para os endpoints acima.
- [x] Tela dashboard: cartões de resumo (horas totais, progresso %, questões).
- [x] Gráfico de barras — horas por disciplina. (SVG, cor única `--chart-1` — magnitude; rótulos/valores em texto.)
- [x] Gráfico de linha — série temporal (toggle dia/semana, seletor de intervalo). (viewBox responsivo via ResizeObserver — legibilidade mobile, achado do review.)
- [x] Indicador/anel de progresso %.
- [x] Tabela de desempenho em questões (com taxa de erro). (Agrupamento disciplina/tema.)
- [x] Estados de vazio (aluno sem sessões) e de carregamento.
- [x] Suporte a tema claro/escuro nos gráficos (ver [pwa-frontend](../../03-nao-funcionais/pwa-frontend.md)). (Só tokens; paleta `--chart-1..8` validada p/ CVD e contraste nos 4 temas.)
- [ ] [Fase 2] Painel comparativo aluno vs. turma.
- [ ] [Fase 2] Visualização de tendências/projeção.

## Testes

- [x] Unit (service): horas totais ignora sessões com `fim` nulo (CA-01).
- [x] Unit: progresso `0` quando plano ativo sem subtemas (CA-03).
- [x] Unit: série temporal preenche buckets vazios com `0` (CA-04).
- [x] Unit: `taxaErro=0` quando `total=0` (CA-05).
- [x] Integração: agregação por timezone (fronteira de dia/semana) — RN-03. (Sessão 23h local ≠ dia UTC; fronteira de semana domingo/segunda.)
- [x] Integração: `403` em acesso cruzado (CA-06). (401 sem token; 403 p/ papéis internos; isolamento entre alunos.)
- [x] Integração: `422` para intervalo inválido. (from>to, data inexistente, enum inválido, teto da série.)

> Fechamento MVP (2026-07-23): 44 unit + 26 e2e no backend (suíte total 454/258 verde), 286 testes vitest no frontend. Pendências registradas: trocar o proxy do plano ativo quando `AlunoPlanoAtivo` existir; follow-ups BAIXOS do review — grupo com tema fora do lookup é omitido de `data[]` (inalcançável com FK atual) e credencial do banco de teste repetida nos e2e (padrão pré-existente, extrair helper).
- [ ] [Fase 2] `403` em comparativo sem matrícula ATIVA (CA-07).

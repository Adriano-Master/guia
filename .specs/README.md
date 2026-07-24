# Especificações — Plataforma de Planejamento de Estudos

Fonte-da-verdade das especificações do produto. Estas specs derivam do brain-dump em [`../ideia.txt`](../ideia.txt), organizadas e **melhoradas** (regras de negócio, modelo de dados, contratos de API, algoritmo do cronograma).

## Como usar

- Leia na ordem: **visão → arquitetura → features → não-funcionais**.
- Cada feature tem `requirements.md` (o quê/regras), `design.md` (dados + API) e `tasks.md` (checklist de implementação).
- Ao implementar, aponte o Claude Code para a spec da feature: *"implemente seguindo `.specs/02-features/<feature>/`"*.
- **Regra de ouro:** nenhuma entidade nova fora de [01-arquitetura/data-model.md](01-arquitetura/data-model.md); nenhum endpoint fora de [01-arquitetura/api-conventions.md](01-arquitetura/api-conventions.md).

## Índice

- [00 — Visão de Produto](00-visao-produto.md)
- **01 — Arquitetura**
  - [Visão geral](01-arquitetura/overview.md)
  - [Modelo de dados](01-arquitetura/data-model.md)
  - [Convenções de API](01-arquitetura/api-conventions.md)
- **02 — Features**
  - [Auth e usuários](02-features/auth-e-usuarios/requirements.md) · MVP
  - [Turmas](02-features/turmas/requirements.md) · MVP
  - [Plano de estudo](02-features/plano-de-estudo/requirements.md) · MVP
  - [Cronograma e calendário](02-features/cronograma-e-calendario/requirements.md) · MVP ★
  - [Cronômetro e sessões](02-features/cronometro-e-sessoes/requirements.md) · MVP
  - [Progresso](02-features/progresso/requirements.md) · MVP
  - [Questões e desempenho](02-features/questoes-e-desempenho/requirements.md) · MVP (+ recomendação Fase 2)
  - [Estatísticas](02-features/estatisticas/requirements.md) · MVP básico
  - [Gamificação e ranking](02-features/gamificacao-ranking/requirements.md) · Fase 2
  - [Integração Hotmart](02-features/integracao-hotmart/requirements.md) · Fase 2
- **03 — Não-funcionais**
  - [PWA e frontend](03-nao-funcionais/pwa-frontend.md)
  - [Interface glassmorphism (4 temas de cor)](03-nao-funcionais/glassmorphism-ui.md)
  - [Qualidade, segurança e operação](03-nao-funcionais/qualidade.md)

## Roadmap por fase

| Fase | Entregas |
|---|---|
| **MVP (Fase 1)** | Auth própria + roles · Turmas/matrículas · Plano (disciplina/tema/subtema + pesos, oficial vs pessoal) · Geração de cronograma no calendário · Cronômetro + registro manual · Progresso por subtema · Registro básico de questões · Estatísticas básicas · PWA responsivo (tema claro/escuro, menu lateral). |
| **Fase 2** | Gamificação (ranking turma/global) · Recomendação de estudo por taxa de erro · Integração Hotmart (webhook) · Rebalanceamento automático do cronograma · Estatísticas avançadas · Offline avançado. |

## Rastreabilidade — requisito do `ideia.txt` → spec

| Requisito original (`ideia.txt`) | Coberto em |
|---|---|
| Usuários internos vs externos; roles | [auth-e-usuarios](02-features/auth-e-usuarios/requirements.md) |
| Gerenciar turmas; vincular plano à turma | [turmas](02-features/turmas/requirements.md) |
| Plano com disciplina/tema/subtema (item 1) | [plano-de-estudo](02-features/plano-de-estudo/requirements.md) |
| Aluno segue oficial ou cria o próprio | [plano-de-estudo](02-features/plano-de-estudo/requirements.md) (derivação) |
| Tempo/peso sugerido por disciplina (item 2) | [plano-de-estudo](02-features/plano-de-estudo/requirements.md) (PesoDisciplina) |
| Distribuir plano em cronograma no calendário (item 3) | [cronograma-e-calendario](02-features/cronograma-e-calendario/design.md) ★ |
| Cronômetro por matéria + tempo manual (item 4) | [cronometro-e-sessoes](02-features/cronometro-e-sessoes/requirements.md) |
| Progresso: marcar tema concluído (item 5) | [progresso](02-features/progresso/requirements.md) |
| Registrar questões/erros + sugestão por erro (item 6) | [questoes-e-desempenho](02-features/questoes-e-desempenho/requirements.md) |
| Página de calendário (item 7) | [cronograma-e-calendario](02-features/cronograma-e-calendario/requirements.md) |
| Estatísticas (horas totais / por disciplina) | [estatisticas](02-features/estatisticas/requirements.md) |
| Gamificação: ranking turma e global | [gamificacao-ranking](02-features/gamificacao-ranking/requirements.md) |
| Arquitetura: Postgres/Node MVC/ORM/Angular/Docker | [overview](01-arquitetura/overview.md) |
| Design: menu lateral, tema claro/escuro, PWA, responsivo | [pwa-frontend](03-nao-funcionais/pwa-frontend.md) |
| Integração Hotmart (base de usuários via webhook) | [integracao-hotmart](02-features/integracao-hotmart/requirements.md) |

## Glossário

- **Plano OFICIAL** — criado por usuário interno, vinculável a turmas.
- **Plano PESSOAL** — criado/derivado por um aluno; cópia independente de um oficial.
- **Bloco de cronograma** — slot de tempo no calendário com disciplina (e subtema sugerido).
- **Sessão de estudo** — tempo registrado (cronômetro ou manual) numa disciplina.
- **Peso da disciplina** — percentual do tempo semanal destinado a uma disciplina (Σ = 100%).

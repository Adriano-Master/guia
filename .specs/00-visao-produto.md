# Visão de Produto

> Documento-raiz da visão. Define **por que** a plataforma existe, **para quem**, **o que** entrega e **em que ordem**. Todas as specs de feature derivam daqui.

## 1. Problema

Estudantes de concursos públicos precisam cobrir editais extensos (muitas disciplinas, temas e subtemas) com tempo limitado e disperso ao longo da semana. Hoje, organizam isso em planilhas manuais que:

- não convertem prioridade (peso por disciplina) em um cronograma concreto no calendário;
- não medem tempo real de estudo por disciplina;
- não acompanham progresso por tema/subtema nem desempenho em questões;
- não geram disciplina/motivação (sem metas, sem comparação com pares).

## 2. Proposta de valor

Uma plataforma que transforma um **plano de estudo** (disciplina → tema → subtema, com pesos) e a **disponibilidade do aluno** (dias, horários, horas) em um **cronograma automático em calendário**, com **cronômetro**, **acompanhamento de progresso e desempenho**, **estatísticas** e **gamificação**. Professores/instituições publicam planos oficiais e acompanham turmas; alunos seguem o plano oficial ou criam o próprio.

## 3. Personas

| Persona | Tipo | Objetivo principal |
|---|---|---|
| **Admin** | Interno | Gerenciar a plataforma, usuários e permissões. |
| **Moderador** | Interno | Curar conteúdo (disciplinas/temas), moderar turmas. |
| **Professor** | Interno | Criar planos de estudo oficiais e vinculá-los a turmas; acompanhar alunos. |
| **Aluno** | Externo | Seguir/criar plano, gerar cronograma, estudar, registrar progresso e desempenho. |

> Usuários **internos** (admin, moderador, professor) e **externos** (aluno) são a divisão central de autorização — ver [auth-e-usuarios](02-features/auth-e-usuarios/requirements.md).

## 4. Objetivos e métricas de sucesso

- **Ativação:** % de alunos que geram ao menos 1 cronograma na 1ª semana.
- **Engajamento:** média de horas de estudo registradas/aluno/semana; nº de sessões via cronômetro.
- **Conclusão:** % de subtemas marcados como concluídos vs planejados.
- **Retenção:** alunos ativos (≥1 sessão) na semana N.

## 5. Escopo por fase

### MVP (Fase 1)
Cadeia de valor mínima para um aluno estudar de ponta a ponta:
- Autenticação própria (email/senha) + roles ([auth-e-usuarios](02-features/auth-e-usuarios/requirements.md)).
- Gestão de turmas e matrículas ([turmas](02-features/turmas/requirements.md)).
- Plano de estudo com disciplina/tema/subtema e pesos; oficial vs próprio ([plano-de-estudo](02-features/plano-de-estudo/requirements.md)).
- Geração de cronograma no calendário ([cronograma-e-calendario](02-features/cronograma-e-calendario/requirements.md)).
- Cronômetro + registro manual de tempo ([cronometro-e-sessoes](02-features/cronometro-e-sessoes/requirements.md)).
- Progresso por subtema ([progresso](02-features/progresso/requirements.md)).
- Registro básico de questões/erros ([questoes-e-desempenho](02-features/questoes-e-desempenho/requirements.md)).
- Estatísticas básicas ([estatisticas](02-features/estatisticas/requirements.md)).
- PWA responsivo, tema claro/escuro, menu lateral ([pwa-frontend](03-nao-funcionais/pwa-frontend.md)).

### Fase 2
- Gamificação: ranking por turma e global ([gamificacao-ranking](02-features/gamificacao-ranking/requirements.md)).
- Recomendação de estudo baseada em erros de questões (bônus do item 6 do `ideia.txt`).
- Integração Hotmart: provisionar/revogar acesso via webhook ([integracao-hotmart](02-features/integracao-hotmart/requirements.md)).
- Rebalanceamento automático do cronograma quando o aluno atrasa.

### Futuro (não especificado aqui)
Notificações push, importação de editais, compartilhamento social, planos colaborativos.

## 6. Restrições de arquitetura (herdadas do `ideia.txt`)

- Banco **PostgreSQL**; backend **Node.js** em **MVC** com **ORM**; frontend **Angular**; tudo em **Docker**.
- Frontend **PWA** instalável, responsivo, com tema claro/escuro e menu lateral.
- Detalhes em [01-arquitetura/overview.md](01-arquitetura/overview.md).

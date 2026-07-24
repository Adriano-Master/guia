# Progresso — Tarefas

**Fase: [MVP]**

Base: [requirements.md](requirements.md) · [design.md](design.md).

## Backend

- [x] Modelar/migrar `ProgressoSubtema` conforme [data-model.md](../../01-arquitetura/data-model.md) (unique `(aluno_id, subtema_id)`, `concluido`, `concluido_em`, timestamps). (Model/tabela já criados na feature cronograma; conferido contra o data-model, sem migration nova.)
- [x] Índice `ProgressoSubtema(aluno_id, subtema_id)`. (Provido pelo unique composto.)
- [x] DTOs: request `{ concluido: boolean }`; responses de marcação, de progresso agregado e de listagem. (Booleanos com `@Transform` lendo o valor bruto — correção de review: o `enableImplicitConversion` coagia `"false"` para `true`; mesmo bug corrigido também em `?publicado=` de planos.)
- [x] `ProgressoService.setConcluido` — upsert idempotente por `(aluno_id, subtema_id)`; seta `concluido_em` na transição para true e o preserva em remarcações; zera ao desmarcar; `404` se subtema inexistente. (Upsert também revive registro soft-deleted.)
- [x] `ProgressoService.calcularPlano` — carrega árvore do plano + progressos do aluno e agrega por folhas (tema/disciplina/plano) com guarda de divisão por zero (0%).
- [x] Query agregada eficiente: `count(*)` e `count filter (concluido)` por tema/disciplina em uma passada. (Implementado como 2 queries + agregação por folhas em memória — a árvore completa já é necessária na resposta; sem N+1; documentado no service.)
- [x] `ProgressoService.listarSubtemas` — flag `concluido` por subtema do plano, com filtros `temaId`, `concluido`. (`temaId` inexistente/de outro plano → 404. Pendência de spec: resposta `{subtemas}` sem paginação diverge do envelope de coleção de api-conventions §4.)
- [x] Controllers/rotas sob `/api/v1/progresso` conforme [design.md](design.md).
- [x] Guard de escopo por aluno (dono); acesso cruzado → `403`. (Escopo de plano provisório via regra de leitura de planos — `AlunoPlanoAtivo`/turmas ainda não existem.)
- [x] Serialização snake_case → camelCase; percentuais com 2 casas; datas ISO-8601 UTC. (Shape estendido com `nome`/`ordem`/`concluidoEm` nos nós para o frontend.)

## Frontend Angular

- [x] Feature module `progresso` (standalone, signals). (+ link "Progresso" na sidebar para ALUNO.)
- [x] `ProgressoService` HTTP (marcar/desmarcar, obter agregado, listar) com interceptor JWT.
- [x] Componente checkbox/toggle de conclusão por subtema com atualização otimista. (Rollback em erro; remarcação preserva data; bloqueio por subtema em voo; guarda de staleness na troca de plano.)
- [x] Componente de árvore de progresso (barras/percentuais por tema, disciplina e plano).
- [x] Indicador de progresso do plano (barra geral + "X de Y subtemas").
- [x] Filtro "mostrar apenas pendentes" (`concluido=false`). (Filtragem local da árvore; oculta nós 100%; agregados exibidos são os reais.)
- [x] Tratamento do envelope de erro (`403`, `404`).
- [x] Responsivo + tema claro/escuro (ver [pwa-frontend](../../03-nao-funcionais/pwa-frontend.md)).

## Testes

- [x] Unit (service): progresso de tema = concluídos/total ×100 — CA-04.
- [x] Unit (service): disciplina/plano agregam por folhas, não por média de médias (ex.: 1/4 = 25%) — DT-02.
- [x] Unit (service): tema/disciplina/plano sem subtemas → 0% (sem divisão por zero) — CA-07, CB-01.
- [x] Unit (service): remarcar concluído preserva `concluido_em` original — CB-05.
- [x] Unit (service): desmarcar zera `concluido_em` — CA-02.
- [x] Unit (service): upsert idempotente por `(aluno_id, subtema_id)` — CA-03, RN-05.
- [x] Integração (API): marcar `subtema_id` inexistente → `404` — CA-09.
- [x] Integração (API): aluno acessa progresso de outro → `403` — CA-08.
- [x] Integração (API): adicionar subtema após marcações reduz o percentual (cálculo sob demanda) — CB-03. (+ encadeamento com cronograma: subtema concluído sai da fila de blocos.)
- [x] E2E (frontend): marcar subtemas atualiza percentuais de tema/disciplina/plano em tempo real. (Coberto como teste de componente: DOM atualiza antes do PUT resolver, com rollback em erro.)

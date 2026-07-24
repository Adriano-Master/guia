# Cronograma e Calendário — Tasks

## Backend
- [x] Migration: tabelas `cronogramas` e `blocos_cronograma` conforme [data-model](../../01-arquitetura/data-model.md#4-cronograma) (índice em `blocos_cronograma(cronograma_id, inicio)`). Inclui `progresso_subtemas` (data-model §5, lida pelo passo 5) e índice único parcial `cronogramas(aluno_id) WHERE ativo` (invariante 1-ativo no banco).
- [x] DTOs de entrada: `GerarCronogramaDto` (planoId, diasSemana, janelas[], granularidadeMin, timezone) com validação (janela ≥ granularidade, diasSemana não vazio).
- [x] `CronogramaService.gerar()` implementando os 6 passos do [design](design.md#algoritmo-de-distribuição-núcleo):
  - [x] Passo 1: enumerar slots das janelas.
  - [x] Passo 2: alocação proporcional com **largest remainder** (garantir Σ = total) — em minutos, robusto a slot-resto.
  - [x] Passo 3: round-robin ponderado (crédito incremental, ponderado pela duração real do slot).
  - [x] Passo 4: agrupar slots contíguos em blocos.
  - [x] Passo 5: atribuir próximo subtema não concluído (consulta a `ProgressoSubtema`).
  - [x] Passo 6: persistir em transação, desativando cronograma anterior. (ADR: materialização de 4 semanas à frente; janelas de hoje já encerradas não são materializadas.)
- [x] Conversão de horário local (timezone) → UTC ao persistir `inicio/fim`.
- [x] Controller/rotas: POST `/cronogramas`, GET `/cronogramas/ativo`, GET `/cronogramas/{id}/blocos`, PATCH `/blocos/{id}`.
- [x] Guard: aluno só acessa os próprios cronogramas/blocos.
- [ ] [Fase 2] POST `/cronogramas/{id}/rebalancear`.

## Frontend (Angular)
- [x] Tela "Configurar cronograma": seletor de dias, editor de janelas (add/remover intervalos), granularidade, timezone; validação client-side.
- [x] Serviço `CronogramaService` (HTTP) + models.
- [x] Tela **Calendário** (semana/~~mês~~) exibindo blocos por dia com disciplina, subtema e duração; cores por disciplina. (Visão mensal pendente — semanal com navegação cobre o MVP.)
- [x] Ação em bloco: marcar `CONCLUIDO`/`PULADO`; atalho "iniciar estudo" é placeholder desabilitado até a feature [cronômetro](../cronometro-e-sessoes/design.md) existir.
- [x] Estado vazio (sem cronograma) com CTA para gerar.
- [x] Responsivo/PWA (ver [pwa-frontend](../../03-nao-funcionais/pwa-frontend.md)).

## Testes
- [x] Unit do algoritmo com o **exemplo numérico** do design (Português/Matemática/Informática/Direito): assert contagem de slots [4,4,2,2] e Σ min = 720.
- [x] Unit: caso peso indivisível (largest remainder fecha o total).
- [x] Unit: disciplina com peso baixo recebe ≥ 1 slot.
- [x] Unit: nenhum bloco se sobrepõe e todos caem nas janelas. (+ regressão: proporcionalidade com janela não múltipla da granularidade.)
- [x] Integração: POST `/cronogramas` gera e desativa o anterior. (e2e API: 22 testes — escopo 403, 422s, fronteira de intervalo, índice único.)
- [ ] E2E: gerar cronograma → ver no calendário → marcar bloco concluído. (Fluxo coberto via API e2e; e2e de UI no navegador pendente.)

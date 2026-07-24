# Cronograma e Calendário — Requirements

**Fase: [MVP]** (rebalanceamento automático por atraso = [Fase 2])

> Esta é a feature central da plataforma. Ela converte um **plano de estudo** (com pesos por disciplina) + a **disponibilidade do aluno** em um **cronograma concreto distribuído num calendário**.

## Objetivo

Dado um plano e a rotina informada pelo aluno (dias da semana, janelas de horário e horas), gerar automaticamente uma agenda que respeite o **peso percentual de cada disciplina**, preenchendo os blocos de tempo disponíveis, e exibir isso num calendário navegável.

## User stories

- Como **aluno**, quero informar meus dias, horários e horas de estudo para que a plataforma monte meu cronograma sem eu ter que distribuir manualmente.
- Como **aluno**, quero que disciplinas com maior peso ocupem proporcionalmente mais tempo na semana.
- Como **aluno**, quero ver no calendário, por dia, quais disciplinas estudar e por quanto tempo.
- Como **aluno**, quero que cada bloco sugira o **próximo subtema não concluído** daquela disciplina.
- Como **aluno**, quero marcar um bloco como concluído ou pulado.
- Como **aluno** (Fase 2), quero que o cronograma se rebalanceie quando eu atraso, sem refazer tudo à mão.

## Entradas do aluno

1. **Dias da semana** que vai estudar (ex.: seg, qua, sex).
2. **Janelas de horário** por dia (ex.: 08:00–10:00 e 14:00–16:00).
3. Horas totais/semana derivam das janelas (validação cruzada).
4. **Granularidade** do bloco (default 30 min; opções 15/30/60).
5. Fuso horário do aluno (IANA).

## Critérios de aceitação

- [ ] A soma dos tempos alocados a todas as disciplinas na semana = tempo total disponível informado (tolerância de 1 granularidade por arredondamento).
- [ ] O tempo alocado a cada disciplina é proporcional ao seu `peso_percentual` (dentro do erro de arredondamento por slot).
- [ ] Todo bloco cai dentro de uma janela informada e em um dia informado.
- [ ] Blocos não se sobrepõem.
- [ ] Cada bloco referencia uma `Disciplina` e, quando houver subtema pendente, um `Subtema` (o próximo não concluído por ordem).
- [ ] Regerar o cronograma substitui o anterior (só 1 `Cronograma.ativo` por aluno).
- [ ] O aluno consegue marcar bloco como `CONCLUIDO`/`PULADO`.
- [ ] Recorrência: o padrão semanal se repete até o aluno regerar/alterar.

## Regras de negócio

1. **Fonte dos pesos:** `PesoDisciplina` do plano do aluno (Σ = 100). Se algum peso mudar, o cronograma precisa ser regerado.
2. **Proporcionalidade:** minutos_por_disciplina_semana = round(peso% × minutos_totais_semana), ajustando o resto para fechar exatamente o total (ver algoritmo em [design.md](design.md)).
3. **Preenchimento dos slots:** distribuir os minutos de cada disciplina ao longo dos slots disponíveis com **rotação** (round-robin ponderado), evitando concentrar tudo de uma disciplina no mesmo dia quando possível.
4. **Subtema no slot:** escolher o próximo `Subtema` não concluído (menor `ordem`) da disciplina; se todos concluídos, o bloco fica só com a disciplina (revisão).
5. **Cronograma único ativo:** gerar novo desativa o anterior.

## Casos de borda

- Tempo total não divisível pela granularidade → último slot do dia pode ser menor (ou descartado conforme configuração; padrão: encaixa o resto no último slot).
- Disciplina com peso muito baixo que não alcança 1 slot na semana → acumula para semanas seguintes ou recebe no mínimo 1 slot (decisão: mínimo 1 slot se peso > 0 e houver espaço; documentar em design).
- Janela menor que a granularidade → rejeitar com `422`.
- Soma das janelas ≠ horas informadas → usar as janelas como verdade e recalcular horas (avisar o usuário).
- Plano sem pesos definidos → bloquear geração com `422`.
- Fuso/horário de verão → armazenar UTC, exibir no TZ (ADR-03).

## Dependências

- [plano-de-estudo](../plano-de-estudo/requirements.md) (Disciplina/Tema/Subtema, PesoDisciplina)
- [progresso](../progresso/requirements.md) (para saber o próximo subtema não concluído)
- [cronometro-e-sessoes](../cronometro-e-sessoes/requirements.md) (uma sessão pode nascer de um bloco)
- Modelo: [Cronograma / BlocoCronograma](../../01-arquitetura/data-model.md#4-cronograma)

---
name: implementar-feature
description: Use quando o usuário pedir para implementar uma feature inteira da plataforma de estudos a partir das specs (ex.: "implemente a feature auth-e-usuarios", "desenvolva o cronograma seguindo a spec", "vamos construir turmas"). Orquestra o fluxo spec → código → testes → review usando os agentes codificador, testador e revisor. É a skill guarda-chuva para trabalho spec-driven.
---

# Skill: Implementar uma feature (spec-driven)

Fluxo padrão para transformar uma spec de `.specs/02-features/<feature>/` em código pronto, testado e revisado. Use os agentes especializados do projeto.

## Pré-requisitos
- A feature existe em `.specs/02-features/<feature>/` com `requirements.md`, `design.md`, `tasks.md`.
- Os contratos globais valem sempre: `.specs/01-arquitetura/{data-model,api-conventions,overview}.md`.
- Ambiente de dev disponível (senão, rode antes a skill `ambiente-docker`).

## Passo a passo

1. **Ler a spec.** Leia os 3 arquivos da feature + os contratos globais. Confirme a **fase** (MVP vs Fase 2) e o que está no escopo. Se houver dependência de outra feature não implementada, resolva a ordem primeiro.

2. **Planejar a ordem.** Backend antes de frontend, na sequência do `tasks.md`: model/migration → service (regras) → controller/DTO → feature Angular. Para features grandes, fatie em partes coerentes.

3. **Implementar (agente `codificador`).** Delegue a implementação de cada fatia. Para módulos backend, a skill `modulo-backend` dá o gabarito; para telas, a skill `feature-angular`.

4. **Testar (agente `testador`).** Assim que uma fatia backend estiver pronta, delegue a cobertura de testes — priorizando as regras críticas (algoritmo do cronograma, Σ pesos=100, progresso, 409 do cronômetro, idempotência do webhook). Rodar a suíte e reportar resultado real.

5. **Revisar (agente `revisor`).** Antes de dar a feature como concluída, delegue o code review (correção + aderência às specs + segurança). Achados voltam ao `codificador` para correção; re-teste se necessário.

6. **Fechar.** Marque os itens de `tasks.md` que foram concluídos e resuma o que ficou pendente. Não altere as specs.

## Boas práticas
- Um agente por papel: implementar ≠ testar ≠ revisar (evita viés de "quem escreve valida o próprio código").
- Se a spec tiver lacuna/contradição, **pare e sinalize** ao usuário em vez de improvisar entidade/rota.
- Mantenha o loop curto: fatia pequena → testa → revisa → próxima fatia.

## Ordem recomendada do MVP
`auth-e-usuarios` → `plano-de-estudo` → `cronograma-e-calendario` → `cronometro-e-sessoes` → `progresso` → `turmas` → `questoes-e-desempenho` → `estatisticas`. Gamificação e Hotmart são Fase 2.

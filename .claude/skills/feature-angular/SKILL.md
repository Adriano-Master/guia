---
name: feature-angular
description: Use ao criar a parte frontend Angular de uma feature (ex.: "crie a tela do calendário", "monte a feature de login no Angular", "faça a UI de progresso"). Gera componentes standalone + serviço HTTP + guard por role + rota lazy, integrados ao interceptor de JWT/erro e ao design PWA do projeto.
---

# Skill: Gerar uma feature Angular

Gabarito para o frontend de uma feature. Frontend: **Angular v17+**, standalone components, signals, PWA.

## Antes de gerar
- Leia o `design.md` da feature (endpoints que a tela consome) e `.specs/01-arquitetura/api-conventions.md` (formato de resposta/erro/paginação).
- Siga `.specs/03-nao-funcionais/pwa-frontend.md` (responsivo, tema claro/escuro, menu lateral, acessibilidade).

## Estrutura (`/frontend/src/app/features/<feature>/`)
```
<feature>.routes.ts          # rota lazy (loadComponent/loadChildren) + guard
<feature>-list.component.ts  # componentes standalone (tela/subtelas)
<feature>-form.component.ts
<feature>.service.ts         # HTTP tipado para /api/v1/...
models/<feature>.model.ts    # interfaces (camelCase, espelhando o response DTO)
```

## Checklist
- [ ] **Componentes standalone** (`standalone: true`), estado com signals/serviços; sem estado global desnecessário.
- [ ] **Serviço HTTP** tipado, consumindo `/api/v1/...`; tratar resposta paginada `{data,page,pageSize,total}`.
- [ ] **Rota lazy** por feature (code splitting) + **guard por role** (aluno vs interno).
- [ ] Reaproveitar o **interceptor** de `core/` que anexa o JWT e trata `401` (refresh) e o envelope de erro padrão — não reimplementar.
- [ ] **Responsivo**: layout fluido, breakpoints mobile/tablet/desktop, alvos de toque ≥44px, sem scroll horizontal. Ex.: calendário vira lista por dia no mobile.
- [ ] **Tema claro/escuro** via CSS variables; respeitar `prefers-color-scheme` e a preferência salva.
- [ ] **Acessibilidade**: navegação por teclado, foco visível, labels ARIA, contraste AA.
- [ ] Registrar a entrada no **menu lateral** quando a feature tiver navegação própria.
- [ ] Estados de **loading / erro / vazio** com CTA.

## Depois de gerar
Rode `build` para garantir que compila. **Não escreva testes aqui** — encaminhe ao agente `testador`. Resuma componentes/rotas criados.

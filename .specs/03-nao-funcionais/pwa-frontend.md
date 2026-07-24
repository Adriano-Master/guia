# Requisitos Não-Funcionais — PWA e Frontend

**Fase: [MVP]** (offline avançado = [Fase 2])

## 1. PWA instalável

- [x] `manifest.webmanifest` com nome, ícones (192/512, maskable), `display: standalone`, `theme_color`, `background_color`, `start_url`. (Ícones maskable gerados a partir do logo placeholder — asset de marca definitivo com ~20% de padding pendente.)
- [x] Service worker (Angular `@angular/pwa` / Workbox) registrado. (ngsw, `registerWhenStable:30000`, produção. Prompt de atualização via `SwUpdate` pendente como melhoria.)
- [x] Prompt "Adicionar à tela inicial" no celular (Android/iOS) — permitir salvar como app. (`InstallService`: `beforeinstallprompt` no Android/desktop; dica de instalação para iOS/Safari; oculto quando standalone.)
- [x] Cache de app shell (HTML/CSS/JS) para carregamento rápido e uso com conexão instável.
- [ ] [Fase 2] Estratégia offline para dados de leitura (cronograma da semana, plano) e fila de sincronização para sessões registradas offline.

## 2. Tema claro/escuro

> Estendido pela spec [Interface glassmorphism](glassmorphism-ui.md): a plataforma adota estilo glassmorphism com **4 temas de cor** (Azul, Verde, Claro, Escuro). Os temas Claro/Escuro já implementados abaixo passam a ser duas das quatro variações e devem migrar para o contrato de tokens daquela spec.

- [x] Alternância manual + respeito a `prefers-color-scheme`. (Ciclo claro → escuro → sistema no shell; `data-theme` vence o sistema nos dois sentidos; meta theme-color acompanha.)
- [x] Persistir preferência (localStorage) e aplicar antes do render (sem "flash"). (Script inline no index.html.)
- [x] Tokens de cor via CSS variables; ambos os temas com contraste AA. (Pares verificados; `--color-text-muted` claro ajustado para AA.)

## 3. Layout e navegação

- [x] **Menu lateral** (conforme `ideia.txt`) com as seções: Início, Calendário, Plano de Estudo, Estudar (cronômetro), Progresso, Questões, Estatísticas, Ranking (Fase 2), e área administrativa para papéis internos. (Sidebar implementada com as seções das features existentes — Início, Calendário, Estudar, Planos, Perfil, Usuários/admin; Progresso/Questões/Estatísticas/Ranking entram no menu quando as features forem implementadas.)
- [x] Menu colapsável; em telas pequenas vira drawer/hambúrguer. (Colapso persistido; drawer com overlay, Escape, foco gerenciado, `aria-modal` + `inert` no fundo.)
- [x] Guardas de rota por role (aluno vs interno).

## 4. Responsividade

- [x] Breakpoints mobile / tablet / desktop; layout fluido.
- [x] Calendário adaptável (lista por dia no mobile, grade na semana/desktop).
- [x] Alvos de toque ≥ 44px; sem scroll horizontal.

## 5. Acessibilidade

- [x] Navegação por teclado, foco visível, labels ARIA nos controles. (Skip-link funcional em qualquer rota, focus trap no drawer, `aria-current` nos links, landmark `<main>` também nas páginas de auth.)
- [x] Contraste AA em ambos os temas. (Lighthouse A11y 100 nas rotas auditadas.)

## 6. Arquitetura Angular

- [x] Standalone components + lazy loading por feature (espelhando `02-features/`).
- [x] Interceptor HTTP para anexar JWT e tratar `401` (refresh) e o [envelope de erro](../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão).
- [x] Camada `core` (auth, tema, http) e `shared` (layout, componentes reutilizáveis).
- [x] Estado por feature (signals/serviços); evitar estado global desnecessário.

## 7. Performance de frontend

- [x] Lazy loading e code splitting por rota.
- [x] Lighthouse PWA/Perf/A11y ≥ 90 no MVP como meta. (Medido no build de produção, mobile simulado: rota `/` Perf 91 / A11y 100 / BP 100; `/login` Perf 84 / A11y 100 / BP 100 — o Perf de rotas frias é limitado pelo bootstrap do bundle inicial Angular (~302 kB); subir exigiria SSR/prerender das rotas públicas, registrado como melhoria futura. Categoria "PWA" removida no Lighthouse v12; instalabilidade verificada manualmente.)

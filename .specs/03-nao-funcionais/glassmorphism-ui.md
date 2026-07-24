# Requisitos Não-Funcionais — Interface Glassmorphism

**Fase: [MVP]**

> Define a identidade visual da plataforma: um modo de interface **glassmorphism** (superfícies translúcidas com desfoque de fundo) com **4 opções de tema de cor**: **Azul**, **Verde**, **Claro** e **Escuro**. Estende a seção [Tema claro/escuro](pwa-frontend.md#2-tema-claroescuro) do `pwa-frontend.md` — os temas Claro e Escuro exigidos lá passam a ser duas das quatro variações aqui.

## 1. Estilo glassmorphism (base visual)

Todas as superfícies elevadas (cards, menu lateral, modais, toolbar, popovers) seguem o mesmo padrão de "vidro":

- [x] Fundo translúcido: cor de superfície com alpha (ex.: `rgba(..., 0.55–0.75)`), nunca 100% opaco. (`--surface-glass` alpha 0.62; itens de lista usam `--surface-flat` 0.8 por §6.)
- [x] Desfoque do conteúdo atrás: `backdrop-filter: blur(12–20px) saturate(1.4)` (com prefixo `-webkit-` para Safari/iOS).
- [x] Borda sutil de 1px translúcida (ex.: `rgba(255,255,255,0.18)` nos temas escuros; tom escuro suave nos claros) para destacar o vidro do fundo.
- [x] Cantos arredondados e sombra difusa suave, consistentes via tokens (`--glass-radius`, `--glass-shadow`).
- [x] Fundo da página com gradiente/formas suaves na cor do tema — o desfoque só é perceptível se houver algo atrás do vidro. (`body::before` fixo, sem repaint no scroll.)
- [x] **Fallback obrigatório**: quando `backdrop-filter` não for suportado (`@supports not (backdrop-filter: blur(1px))`), usar superfície quase opaca (alpha ≥ 0.92) mantendo a mesma hierarquia visual. (Alpha 0.94; review pegou bug de especificidade que anulava o fallback — corrigido com `:root, :root[data-theme]` + ordem, verificado no CSS compilado e travado por teste de regressão.)

## 2. Os 4 temas de cor

- [x] **Azul** — fundo em gradiente de azuis profundos; vidro azulado; acento azul/ciano.
- [x] **Verde** — fundo em gradiente de verdes; vidro esverdeado; acento verde/esmeralda.
- [x] **Claro** — fundo claro (brancos/cinzas frios com gradiente sutil); vidro branco translúcido; texto escuro.
- [x] **Escuro** — fundo escuro neutro (grafite/quase-preto); vidro escuro translúcido; texto claro.
- [x] Cada tema define o conjunto completo de tokens (ver §3); nenhum componente usa cor fora dos tokens. (Exceção registrada: paleta decorativa de 8 cores do calendário — pendência para tokens `--chart-*` por tema.)
- [x] Azul e Verde são temas de base escura (texto claro); Claro é o único de base clara.

## 3. Tokens (CSS variables)

- [x] Todos os temas expõem o mesmo contrato de tokens em `:root[data-theme="azul|verde|claro|escuro"]`:
  - `--bg-gradient` (fundo da página), `--surface-glass` (cor+alpha do vidro), `--glass-border`, `--glass-blur`, `--glass-radius`, `--glass-shadow`;
  - `--text-primary`, `--text-secondary`, `--accent`, `--accent-contrast`;
  - estados: `--success`, `--warning`, `--danger`, `--info`.
  (+ `--surface-flat`/`--surface-inset`/`--surface-solid` e aliases `--color-*` legados mapeados por tema, para as telas existentes renderizarem sem ajuste por componente.)
- [x] Trocar de tema = trocar apenas o atributo `data-theme` no `<html>`; zero mudança em componentes.
- [x] `theme_color` do manifest PWA e `<meta name="theme-color">` acompanham o tema ativo. (Meta dinâmica via ThemeService; manifest é estático por limitação de plataforma — fixado no escuro, ressalva documentada.)

## 4. Seleção e persistência

- [x] Seletor de tema acessível nas configurações e no menu lateral (4 opções com pré-visualização/swatch). (Rodapé da sidebar compact + card "Aparência" no perfil expanded; 5ª opção "Sistema".)
- [x] Persistir escolha em `localStorage` e aplicar **antes do primeiro render** (script inline no `index.html`) — sem "flash" de tema errado. (Com migração dos valores legados light/dark, blindada contra chaves de protótipo.)
- [x] Padrão para primeiro acesso: respeitar `prefers-color-scheme` — Escuro se `dark`, Claro se `light`; usuário pode trocar para Azul/Verde a qualquer momento. (Reativo via matchMedia enquanto em "Sistema".)
- [x] Gerenciado pelo serviço de tema na camada `core` do Angular (ver [pwa-frontend §6](pwa-frontend.md#6-arquitetura-angular)).

## 5. Acessibilidade e legibilidade

- [x] Contraste **AA** (4.5:1 texto normal, 3:1 texto grande) medido sobre a superfície de vidro **com o fundo mais desfavorável do tema** — transparência não pode degradar leitura. (Composite vidro×pior stop calculado de forma independente 2×; pior par global 4.71 no vidro e 5.45 no flat; tabela em styles.scss.)
- [x] Respeitar `prefers-reduced-transparency`: reduzir alpha/blur para superfícies quase opacas. (Corrigido no review — mesma cascata do fallback.)
- [x] Foco visível com anel de contraste adequado nos 4 temas.
- [x] Estados (sucesso/erro/aviso) distinguíveis também por ícone/texto, não só por cor.

## 6. Performance

- [x] Limitar camadas com `backdrop-filter` simultâneas (menu, toolbar e 1 nível de card/modal); nunca aplicar blur em listas longas item a item — aplicar no contêiner. (Review pegou `.card` com blur em itens de `@for` em 4 telas — corrigido com `.card--flat` sem blur.)
- [x] Sem blur animado; transições de tema apenas em `background-color`/`color` (≤ 200ms) ou sem transição. (Sem transição de tema.)
- [x] Manter meta Lighthouse Perf ≥ 90 ([pwa-frontend §7](pwa-frontend.md#7-performance-de-frontend)) com o estilo ativo, incluindo em mobile. (Rota `/` Perf 90 / A11y 100 / BP 100, mobile simulado — sem regressão vs pré-glass.)

## 7. Critérios de aceite

- [x] As telas existentes (login, calendário, plano, cronômetro, progresso) renderizam corretamente nos 4 temas sem ajuste por componente. (Via aliases `--color-*`; A11y/color-contrast 100 nos 4 temas via Lighthouse por tema.)
- [x] Troca de tema em runtime é imediata, persiste após reload e não causa flash. (Coberto por testes: switcher, persistência, anti-flash no dist.)
- [x] Auditoria de contraste AA passa nos 4 temas (claro e escuro do vidro). (Lighthouse color-contrast 1.0 nos 4 + recálculo analítico independente.)
- [x] Fallback sem `backdrop-filter` verificado (ex.: Firefox com flag desativada ou browsers antigos). (Verificado no CSS compilado — seletor/ordem da cascata — e por teste de regressão textual; verificação em browser real Firefox com flag off fica como validação manual opcional.)

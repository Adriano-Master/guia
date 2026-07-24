/**
 * Regressão do CRÍTICO do code review (glassmorphism-ui.md §1/§5): os blocos
 * de fallback (@supports not backdrop-filter e prefers-reduced-transparency)
 * eram código morto porque `:root` (0,1,0) perdia para `:root[data-theme]`
 * (0,2,0). A correção exige DUAS condições simultâneas, validadas aqui no
 * fonte (a ordem é preservada pelo compilador no CSS final):
 *   (a) seletor `:root, :root[data-theme]` — empata em especificidade;
 *   (b) blocos DEPOIS do último tema — vence por ordem no fonte.
 * jsdom não aplica @supports/cascata de custom properties, então a validação
 * é textual sobre styles.scss; o CSS COMPILADO do dist é conferido pelo
 * script scratchpad/verifica-cascata-dist.js após o build.
 *
 * Import dinâmico computado: o projeto não tem @types/node e o specifier
 * literal 'node:fs' falharia no type-check; em runtime o vitest roda em Node
 * (ambiente jsdom) e resolve normalmente.
 */

interface NodeFs {
  readFileSync(path: string, encoding: string): string;
}

let scss = '';

beforeAll(async () => {
  const fs = (await import('node' + ':fs')) as unknown as NodeFs;
  // caminho relativo ao cwd do runner (raiz do frontend durante `ng test`)
  scss = fs.readFileSync('src/styles.scss', 'utf8');
});

describe('styles.scss — cascata dos fallbacks de vidro', () => {
  it('os dois blocos de fallback existem e vêm DEPOIS do último bloco de tema (b)', () => {
    const lastThemeBlock = scss.lastIndexOf("[data-theme='");
    const supportsIdx = scss.indexOf('@supports not');
    const reducedIdx = scss.indexOf('prefers-reduced-transparency');

    expect(lastThemeBlock).toBeGreaterThan(-1);
    expect(supportsIdx).toBeGreaterThan(lastThemeBlock);
    expect(reducedIdx).toBeGreaterThan(lastThemeBlock);
  });

  it('(a) fallbacks usam `:root, :root[data-theme]` e cobrem glass E flat', () => {
    // as duas ocorrências (uma por bloco) com os overrides no mesmo corpo
    const re =
      /:root,\s*:root\[data-theme\]\s*\{[^}]*--surface-glass:\s*var\(--surface-solid\);[^}]*--surface-flat:\s*var\(--surface-solid\);/g;
    const matches = scss.match(re) ?? [];
    expect(matches).toHaveLength(2);
  });

  it('reduced-transparency também reduz o blur', () => {
    const reducedIdx = scss.indexOf('prefers-reduced-transparency');
    const bloco = scss.slice(
      reducedIdx,
      scss.indexOf('}', scss.indexOf('--glass-blur', reducedIdx)),
    );
    expect(bloco).toContain('--glass-blur: 4px');
  });

  it('nenhum `:root` puro redefine --surface-glass depois dos temas (regressão)', () => {
    // um `:root {` sem [data-theme] sobrescrevendo surface-glass após os temas
    // reintroduziria o bug para quem tem data-theme definido
    const depoisDosTemas = scss.slice(scss.lastIndexOf("[data-theme='"));
    const blocosRootPuro = depoisDosTemas.match(/(^|\n)\s*:root\s*\{[^}]*--surface-glass[^}]*\}/g);
    expect(blocosRootPuro).toBeNull();
  });

  it('.card--flat zera backdrop-filter (§6: sem blur por item de lista)', () => {
    const idx = scss.indexOf('.card--flat');
    expect(idx).toBeGreaterThan(-1);
    const bloco = scss.slice(idx, scss.indexOf('}', idx));
    expect(bloco).toContain('background: var(--surface-flat)');
    expect(bloco).toContain('backdrop-filter: none');
    expect(bloco).toContain('-webkit-backdrop-filter: none');
  });
});

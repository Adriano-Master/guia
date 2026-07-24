import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { Plano } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import ProgressoPage from './progresso-page';
import type {
  ProgressoMarcacao,
  ProgressoPlano,
  ProgressoSubtemaNode,
  ProgressoTemaNode,
} from './progresso.models';
import { recalcularAgregados } from './progresso.models';
import { ProgressoService } from './progresso.service';

/**
 * Testes de componente da página de progresso (progresso/tasks.md, item E2E):
 * carga da árvore com percentuais, marcação OTIMISTA (percentuais de
 * tema/disciplina/plano mudam no DOM antes do PUT resolver), rollback +
 * alerta em erro, filtro "apenas pendentes" com agregados reais, checkbox
 * travado com PUT em voo, estado vazio e a11y das disclosures.
 */

const NOW = '2026-07-07T12:00:00.000Z';
const QUANDO = '2026-01-05T10:00:00.000Z';

function buildPlanoResumo(id = 'plano-1', titulo = 'Concurso TRT'): Plano {
  return {
    id,
    titulo,
    descricao: null,
    tipo: 'PESSOAL',
    autorId: 'user-1',
    planoOrigemId: null,
    publicado: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function paginated(planos: Plano[]): Paginated<Plano> {
  return { data: planos, page: 1, pageSize: 100, total: planos.length };
}

function sub(id: string, nome: string, concluido = false, concluidoEm: string | null = null) {
  return { subtemaId: id, nome, ordem: 1, concluido, concluidoEm };
}

function tema(id: string, nome: string, subtemas: ProgressoSubtemaNode[]): ProgressoTemaNode {
  return { temaId: id, nome, ordem: 1, subtemas, concluidos: 0, totais: 0, progressoPercentual: 0 };
}

/**
 * Árvore de referência (agregados calculados pela mesma regra do backend):
 * Português: tema Sintaxe [1 concluído] + tema Morfologia [3 pendentes] → 1/4 = 25%
 * Matemática: tema Álgebra [2 concluídos] → 2/2 = 100%
 * Plano: 3/6 = 50%
 */
function buildTree(): ProgressoPlano {
  return recalcularAgregados({
    planoId: 'plano-1',
    progressoPercentual: 0,
    subtemasConcluidos: 0,
    subtemasTotais: 0,
    disciplinas: [
      {
        disciplinaId: 'disc-pt',
        nome: 'Português',
        ordem: 1,
        progressoPercentual: 0,
        concluidos: 0,
        totais: 0,
        temas: [
          tema('tema-sin', 'Sintaxe', [sub('sub-a1', 'Concordância', true, QUANDO)]),
          tema('tema-mor', 'Morfologia', [
            sub('sub-b1', 'Classes de palavras'),
            sub('sub-b2', 'Flexão nominal'),
            sub('sub-b3', 'Flexão verbal'),
          ]),
        ],
      },
      {
        disciplinaId: 'disc-mat',
        nome: 'Matemática',
        ordem: 2,
        progressoPercentual: 0,
        concluidos: 0,
        totais: 0,
        temas: [
          tema('tema-alg', 'Álgebra', [
            sub('sub-c1', 'Equações', true, QUANDO),
            sub('sub-c2', 'Funções', true, QUANDO),
          ]),
        ],
      },
    ],
  });
}

function apiError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message } } });
}

interface ProgressoServiceMock {
  getPlano: ReturnType<typeof vi.fn>;
  setConcluido: ReturnType<typeof vi.fn>;
  listSubtemas: ReturnType<typeof vi.fn>;
}

interface Mocks {
  planos: { list: ReturnType<typeof vi.fn> };
  progresso: ProgressoServiceMock;
}

function buildMocks(tree: ProgressoPlano = buildTree()): Mocks {
  return {
    planos: { list: vi.fn(() => of(paginated([buildPlanoResumo()]))) },
    progresso: {
      getPlano: vi.fn(() => of(tree)),
      setConcluido: vi.fn(() =>
        of({ subtemaId: 'sub-b1', concluido: true, concluidoEm: NOW } as ProgressoMarcacao),
      ),
      listSubtemas: vi.fn(() => of([])),
    },
  };
}

async function createFixture(mocks: Mocks): Promise<ComponentFixture<ProgressoPage>> {
  TestBed.configureTestingModule({
    imports: [ProgressoPage],
    providers: [
      provideRouter([]),
      { provide: PlanosService, useValue: mocks.planos },
      { provide: ProgressoService, useValue: mocks.progresso },
    ],
  });
  const fixture = TestBed.createComponent(ProgressoPage);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<ProgressoPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function pctGeral(fixture: ComponentFixture<ProgressoPage>): string {
  return el(fixture).querySelector('.prog__pct--geral')?.textContent?.trim() ?? '';
}

function disciplinaLi(fixture: ComponentFixture<ProgressoPage>, nome: string): HTMLElement {
  const li = Array.from(el(fixture).querySelectorAll<HTMLElement>('.prog__disciplina')).find(
    (item) => item.querySelector('.prog__nome')?.textContent?.trim() === nome,
  );
  if (!li) throw new Error(`Disciplina "${nome}" não encontrada no DOM`);
  return li;
}

function temaButton(fixture: ComponentFixture<ProgressoPage>, nome: string): HTMLButtonElement {
  const btn = Array.from(
    el(fixture).querySelectorAll<HTMLButtonElement>('button.prog__node--tema'),
  ).find((b) => b.querySelector('.prog__nome')?.textContent?.trim() === nome);
  if (!btn) throw new Error(`Tema "${nome}" não encontrado no DOM`);
  return btn;
}

function checkboxDoSubtema(
  fixture: ComponentFixture<ProgressoPage>,
  nome: string,
): HTMLInputElement {
  const input = Array.from(
    el(fixture).querySelectorAll<HTMLInputElement>('.prog__subtema input[type="checkbox"]'),
  ).find((i) => i.getAttribute('aria-label')?.endsWith(nome));
  if (!input) throw new Error(`Checkbox do subtema "${nome}" não encontrado`);
  return input;
}

async function expandirTema(fixture: ComponentFixture<ProgressoPage>, nome: string): Promise<void> {
  temaButton(fixture, nome).click();
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProgressoPage — carga da árvore', () => {
  it('plano único é auto-selecionado e a árvore renderiza com percentuais reais', async () => {
    const mocks = buildMocks();
    const fixture = await createFixture(mocks);

    expect(mocks.planos.list).toHaveBeenCalledTimes(1);
    expect(mocks.progresso.getPlano).toHaveBeenCalledWith('plano-1');

    expect(pctGeral(fixture)).toBe('50%');
    expect(el(fixture).querySelector('.prog__resumo-contagem')?.textContent).toContain('3');
    expect(el(fixture).querySelector('.prog__resumo-contagem')?.textContent).toContain('6');

    const pt = disciplinaLi(fixture, 'Português');
    expect(pt.querySelector('.prog__contagem')?.textContent?.trim()).toBe('1/4');
    expect(pt.querySelector('.prog__pct')?.textContent?.trim()).toBe('25%');

    const mat = disciplinaLi(fixture, 'Matemática');
    expect(mat.querySelector('.prog__pct')?.textContent?.trim()).toBe('100%');

    // barra geral acessível com o percentual do plano
    const barraGeral = el(fixture).querySelector('.prog__resumo [role="progressbar"]');
    expect(barraGeral?.getAttribute('aria-valuenow')).toBe('50');
    expect(barraGeral?.getAttribute('aria-label')).toContain('3 de 6');
  });

  it('vários planos → não auto-seleciona e pede escolha', async () => {
    const mocks = buildMocks();
    mocks.planos.list.mockReturnValue(
      of(paginated([buildPlanoResumo('plano-1'), buildPlanoResumo('plano-2', 'Outro plano')])),
    );
    const fixture = await createFixture(mocks);

    expect(mocks.progresso.getPlano).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('.prog__state')?.textContent).toContain('Selecione um plano');
  });

  it('erro no GET da árvore → alerta com a mensagem da API', async () => {
    const mocks = buildMocks();
    mocks.progresso.getPlano.mockReturnValue(
      throwError(() => apiError(403, 'FORBIDDEN', 'Você não tem permissão para este plano.')),
    );
    const fixture = await createFixture(mocks);

    const alerta = el(fixture).querySelector('.prog__tree-error');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('Você não tem permissão para este plano.');
  });

  it('plano sem subtemas → estado vazio com link para o conteúdo do plano', async () => {
    const mocks = buildMocks(
      recalcularAgregados({
        planoId: 'plano-1',
        progressoPercentual: 0,
        subtemasConcluidos: 0,
        subtemasTotais: 0,
        disciplinas: [],
      }),
    );
    const fixture = await createFixture(mocks);

    const vazio = el(fixture).querySelector('.prog__empty');
    expect(vazio?.textContent).toContain('ainda não tem subtemas');
    expect(vazio?.querySelector('a')?.getAttribute('href')).toBe('/planos/plano-1');
    expect(el(fixture).querySelector('.prog__resumo')).toBeNull();
  });
});

/** Árvore alternativa (plano-2): Direito com 2 subtemas pendentes → 0%. */
function buildTreeB(): ProgressoPlano {
  return recalcularAgregados({
    planoId: 'plano-2',
    progressoPercentual: 0,
    subtemasConcluidos: 0,
    subtemasTotais: 0,
    disciplinas: [
      {
        disciplinaId: 'disc-dir',
        nome: 'Direito',
        ordem: 1,
        progressoPercentual: 0,
        concluidos: 0,
        totais: 0,
        temas: [tema('tema-con', 'Constitucional', [sub('sub-d1', 'CF/88'), sub('sub-d2', 'Remédios')])],
      },
    ],
  });
}

async function selecionarPlano(
  fixture: ComponentFixture<ProgressoPage>,
  id: string,
): Promise<void> {
  const select = el(fixture).querySelector<HTMLSelectElement>('#prog-plano')!;
  select.value = id;
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
}

describe('ProgressoPage — troca de plano (guarda de staleness)', () => {
  function buildMocksDoisPlanos(treeA$: Subject<ProgressoPlano>): Mocks {
    const mocks = buildMocks();
    mocks.planos.list.mockReturnValue(
      of(paginated([buildPlanoResumo('plano-1'), buildPlanoResumo('plano-2', 'Outro plano')])),
    );
    mocks.progresso.getPlano.mockImplementation((id: string) =>
      id === 'plano-1' ? treeA$ : of(buildTreeB()),
    );
    return mocks;
  }

  it('resposta atrasada do plano trocado é DESCARTADA: árvore exibida é a do plano atual', async () => {
    const treeA$ = new Subject<ProgressoPlano>();
    const mocks = buildMocksDoisPlanos(treeA$);
    const fixture = await createFixture(mocks);

    // seleciona A: resposta segurada → loading visível
    await selecionarPlano(fixture, 'plano-1');
    expect(mocks.progresso.getPlano).toHaveBeenCalledWith('plano-1');
    expect(el(fixture).querySelector('.prog__state')?.textContent).toContain(
      'Carregando progresso',
    );

    // troca rápida para B: resposta imediata → árvore de B
    await selecionarPlano(fixture, 'plano-2');
    expect(disciplinaLi(fixture, 'Direito')).toBeTruthy();
    expect(pctGeral(fixture)).toBe('0%');

    // agora a resposta de A chega atrasada — não pode sobrescrever B
    treeA$.next(buildTree());
    treeA$.complete();
    await fixture.whenStable();

    expect(disciplinaLi(fixture, 'Direito')).toBeTruthy();
    expect(() => disciplinaLi(fixture, 'Português')).toThrow();
    expect(pctGeral(fixture)).toBe('0%');
    // sem loading órfão
    expect(el(fixture).querySelector('.prog__state')).toBeNull();
    expect(fixture.componentInstance.planoId()).toBe('plano-2');
    expect(fixture.componentInstance.tree()?.planoId).toBe('plano-2');
  });

  it('erro atrasado do plano trocado não seta treeError nem apaga a árvore atual', async () => {
    const treeA$ = new Subject<ProgressoPlano>();
    const mocks = buildMocksDoisPlanos(treeA$);
    const fixture = await createFixture(mocks);

    await selecionarPlano(fixture, 'plano-1');
    await selecionarPlano(fixture, 'plano-2');
    expect(disciplinaLi(fixture, 'Direito')).toBeTruthy();

    treeA$.error(apiError(500, 'INTERNAL', 'Erro inesperado no servidor.'));
    await fixture.whenStable();

    expect(el(fixture).querySelector('.prog__tree-error')).toBeNull();
    expect(fixture.componentInstance.treeError()).toBeNull();
    expect(disciplinaLi(fixture, 'Direito')).toBeTruthy();
    expect(pctGeral(fixture)).toBe('0%');
  });

  it('setPlano("") durante o carregamento zera o loading e volta ao estado inicial', async () => {
    const treeA$ = new Subject<ProgressoPlano>();
    const mocks = buildMocksDoisPlanos(treeA$);
    const fixture = await createFixture(mocks);

    await selecionarPlano(fixture, 'plano-1');
    expect(el(fixture).querySelector('.prog__state')?.textContent).toContain(
      'Carregando progresso',
    );

    fixture.componentInstance.setPlano('');
    await fixture.whenStable();

    expect(fixture.componentInstance.loadingTree()).toBe(false);
    expect(el(fixture).querySelector('.prog__state')?.textContent).toContain(
      'Selecione um plano',
    );

    // resposta atrasada de A também não ressuscita árvore/loading
    treeA$.next(buildTree());
    treeA$.complete();
    await fixture.whenStable();
    expect(fixture.componentInstance.tree()).toBeNull();
    expect(el(fixture).querySelector('.prog__state')?.textContent).toContain(
      'Selecione um plano',
    );
  });
});

describe('ProgressoPage — glassmorphism §6', () => {
  it('cards de disciplina usam card--flat (sem camada de blur por item)', async () => {
    const fixture = await createFixture(buildMocks());

    const itens = el(fixture).querySelectorAll('.prog__disciplina');
    expect(itens.length).toBeGreaterThan(0);
    for (const item of itens) {
      expect(item.classList).toContain('card--flat');
    }
  });
});

describe('ProgressoPage — disclosures (a11y)', () => {
  it('disciplinas começam expandidas e temas fechados; aria-expanded alterna no clique', async () => {
    const fixture = await createFixture(buildMocks());

    const discBtn = disciplinaLi(fixture, 'Português').querySelector<HTMLButtonElement>(
      'button.prog__node',
    )!;
    expect(discBtn.getAttribute('aria-expanded')).toBe('true');

    const temaBtn = temaButton(fixture, 'Morfologia');
    expect(temaBtn.getAttribute('aria-expanded')).toBe('false');
    expect(el(fixture).querySelector('#prog-tema-tema-mor')).toBeNull();

    temaBtn.click();
    await fixture.whenStable();
    expect(temaBtn.getAttribute('aria-expanded')).toBe('true');
    expect(el(fixture).querySelector('#prog-tema-tema-mor')).not.toBeNull();
    expect(temaBtn.getAttribute('aria-controls')).toBe('prog-tema-tema-mor');

    temaBtn.click();
    await fixture.whenStable();
    expect(temaBtn.getAttribute('aria-expanded')).toBe('false');
    expect(el(fixture).querySelector('#prog-tema-tema-mor')).toBeNull();

    discBtn.click();
    await fixture.whenStable();
    expect(discBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-controls só existe quando expandido e aponta para um id presente no DOM', async () => {
    const fixture = await createFixture(buildMocks());

    // tema colapsado: sem aria-controls (não pode referenciar id inexistente)
    const temaBtn = temaButton(fixture, 'Morfologia');
    expect(temaBtn.hasAttribute('aria-controls')).toBe(false);

    temaBtn.click();
    await fixture.whenStable();
    const controls = temaBtn.getAttribute('aria-controls');
    expect(controls).toBe('prog-tema-tema-mor');
    expect(document.getElementById(controls!)).not.toBeNull();

    temaBtn.click();
    await fixture.whenStable();
    expect(temaBtn.hasAttribute('aria-controls')).toBe(false);

    // mesmo contrato no nível de disciplina (expandida por default)
    const discBtn = disciplinaLi(fixture, 'Português').querySelector<HTMLButtonElement>(
      'button.prog__node',
    )!;
    const discControls = discBtn.getAttribute('aria-controls');
    expect(discControls).toBe('prog-disc-disc-pt');
    expect(document.getElementById(discControls!)).not.toBeNull();

    discBtn.click();
    await fixture.whenStable();
    expect(discBtn.hasAttribute('aria-controls')).toBe(false);
  });

  it('aria-label do checkbox descreve a ação e o subtema', async () => {
    const fixture = await createFixture(buildMocks());
    await expandirTema(fixture, 'Morfologia');
    await expandirTema(fixture, 'Sintaxe');

    expect(
      checkboxDoSubtema(fixture, 'Classes de palavras').getAttribute('aria-label'),
    ).toBe('Marcar como concluído: Classes de palavras');
    expect(checkboxDoSubtema(fixture, 'Concordância').getAttribute('aria-label')).toBe(
      'Desmarcar conclusão de Concordância',
    );
  });
});

describe('ProgressoPage — marcação otimista', () => {
  it('marcar atualiza tema/disciplina/plano no DOM ANTES do PUT resolver e trava o checkbox', async () => {
    const mocks = buildMocks();
    const put$ = new Subject<ProgressoMarcacao>();
    mocks.progresso.setConcluido.mockReturnValue(put$);
    const fixture = await createFixture(mocks);
    await expandirTema(fixture, 'Morfologia');

    checkboxDoSubtema(fixture, 'Classes de palavras').click();
    await fixture.whenStable();

    expect(mocks.progresso.setConcluido).toHaveBeenCalledExactlyOnceWith('sub-b1', true);

    // PUT ainda em voo — DOM já reflete os novos agregados (otimista)
    expect(pctGeral(fixture)).toBe('66.7%'); // 4/6
    const pt = disciplinaLi(fixture, 'Português');
    expect(pt.querySelector('.prog__contagem')?.textContent?.trim()).toBe('2/4');
    expect(pt.querySelector('.prog__pct')?.textContent?.trim()).toBe('50%');
    const temaBtn = temaButton(fixture, 'Morfologia');
    expect(temaBtn.querySelector('.prog__contagem')?.textContent?.trim()).toBe('1/3');
    expect(temaBtn.querySelector('.prog__pct')?.textContent?.trim()).toBe('33.3%');

    // checkbox travado enquanto o PUT do próprio subtema está em voo
    const checkbox = checkboxDoSubtema(fixture, 'Classes de palavras');
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(true);
    // data provisória de conclusão já aparece no title
    expect(checkbox.closest('label')?.getAttribute('title')).toContain('Concluído em');
    // aria-label acompanha o novo estado
    expect(checkbox.getAttribute('aria-label')).toBe(
      'Desmarcar conclusão de Classes de palavras',
    );

    // PUT resolve com a data definitiva do servidor
    put$.next({ subtemaId: 'sub-b1', concluido: true, concluidoEm: NOW });
    put$.complete();
    await fixture.whenStable();

    const depois = checkboxDoSubtema(fixture, 'Classes de palavras');
    expect(depois.disabled).toBe(false);
    expect(depois.closest('label')?.getAttribute('title')).toContain('07/07/2026');
    expect(pctGeral(fixture)).toBe('66.7%');
  });

  it('não dispara segundo PUT do mesmo subtema enquanto o primeiro está em voo', async () => {
    const mocks = buildMocks();
    mocks.progresso.setConcluido.mockReturnValue(new Subject<ProgressoMarcacao>());
    const fixture = await createFixture(mocks);
    await expandirTema(fixture, 'Morfologia');

    checkboxDoSubtema(fixture, 'Classes de palavras').click();
    await fixture.whenStable();

    // guarda interna: mesmo forçando o método, não repete a chamada
    const node = fixture.componentInstance
      .tree()!
      .disciplinas[0].temas[1].subtemas.find((s) => s.subtemaId === 'sub-b1')!;
    fixture.componentInstance.toggleConclusao(node);

    expect(mocks.progresso.setConcluido).toHaveBeenCalledTimes(1);
  });

  it('PUT com erro → rollback dos percentuais no DOM + alerta com a mensagem', async () => {
    const mocks = buildMocks();
    const put$ = new Subject<ProgressoMarcacao>();
    mocks.progresso.setConcluido.mockReturnValue(put$);
    const fixture = await createFixture(mocks);
    await expandirTema(fixture, 'Morfologia');

    checkboxDoSubtema(fixture, 'Classes de palavras').click();
    await fixture.whenStable();
    expect(pctGeral(fixture)).toBe('66.7%'); // otimista aplicado

    put$.error(apiError(500, 'INTERNAL', 'Erro inesperado no servidor. Tente novamente.'));
    await fixture.whenStable();

    // rollback completo dos agregados
    expect(pctGeral(fixture)).toBe('50%');
    const pt = disciplinaLi(fixture, 'Português');
    expect(pt.querySelector('.prog__contagem')?.textContent?.trim()).toBe('1/4');
    expect(pt.querySelector('.prog__pct')?.textContent?.trim()).toBe('25%');

    const checkbox = checkboxDoSubtema(fixture, 'Classes de palavras');
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);

    const alerta = el(fixture).querySelector('.prog__toggle-error');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('Erro inesperado no servidor. Tente novamente.');
  });

  it('desmarcar envia concluido=false e zera concluidoEm (otimista)', async () => {
    const mocks = buildMocks();
    mocks.progresso.setConcluido.mockReturnValue(new Subject<ProgressoMarcacao>());
    const fixture = await createFixture(mocks);
    await expandirTema(fixture, 'Sintaxe');

    checkboxDoSubtema(fixture, 'Concordância').click();
    await fixture.whenStable();

    expect(mocks.progresso.setConcluido).toHaveBeenCalledExactlyOnceWith('sub-a1', false);
    expect(pctGeral(fixture)).toBe('33.3%'); // 2/6
    const checkbox = checkboxDoSubtema(fixture, 'Concordância');
    expect(checkbox.checked).toBe(false);
    // concluidoEm zerado → title de conclusão some
    expect(checkbox.closest('label')?.getAttribute('title')).toBeNull();
  });

  it('remarcar subtema que já teve conclusão preserva o concluidoEm original', async () => {
    const tree = buildTree();
    // estado possível do contrato: desmarcado, mas com histórico de conclusão
    tree.disciplinas[0].temas[1].subtemas[0] = sub(
      'sub-b1',
      'Classes de palavras',
      false,
      QUANDO,
    );
    const mocks = buildMocks(recalcularAgregados(tree));
    mocks.progresso.setConcluido.mockReturnValue(new Subject<ProgressoMarcacao>());
    const fixture = await createFixture(mocks);
    await expandirTema(fixture, 'Morfologia');

    checkboxDoSubtema(fixture, 'Classes de palavras').click();
    await fixture.whenStable();

    expect(mocks.progresso.setConcluido).toHaveBeenCalledWith('sub-b1', true);
    // preserva a data original (05/01/2026), não gera uma provisória nova
    expect(
      checkboxDoSubtema(fixture, 'Classes de palavras').closest('label')?.getAttribute('title'),
    ).toContain('05/01/2026');
  });
});

describe('ProgressoPage — filtro "apenas pendentes"', () => {
  it('oculta concluídos e nós 100%, mantendo os agregados reais no indicador', async () => {
    const fixture = await createFixture(buildMocks());

    const filtro = el(fixture).querySelector<HTMLInputElement>('.prog__filtro input')!;
    filtro.click();
    await fixture.whenStable();

    // Matemática (100%) some; Português fica só com o tema pendente
    expect(() => disciplinaLi(fixture, 'Matemática')).toThrow();
    const pt = disciplinaLi(fixture, 'Português');
    expect(pt.textContent).not.toContain('Sintaxe'); // tema 100% oculto
    expect(pt.textContent).toContain('Morfologia');

    // filtro expande os temas: os 3 pendentes ficam visíveis, sem os concluídos
    expect(checkboxDoSubtema(fixture, 'Classes de palavras')).toBeTruthy();
    expect(() => checkboxDoSubtema(fixture, 'Concordância')).toThrow();

    // agregados exibidos continuam sendo os REAIS, não os filtrados
    expect(pctGeral(fixture)).toBe('50%');
    expect(pt.querySelector('.prog__contagem')?.textContent?.trim()).toBe('1/4');
    expect(pt.querySelector('.prog__pct')?.textContent?.trim()).toBe('25%');

    // desligar o filtro restaura a árvore completa
    filtro.click();
    await fixture.whenStable();
    expect(disciplinaLi(fixture, 'Matemática')).toBeTruthy();
  });

  it('tudo concluído + filtro → mensagem de "nenhum pendente" com agregado 100%', async () => {
    const tree = buildTree();
    for (const d of tree.disciplinas)
      for (const t of d.temas)
        t.subtemas = t.subtemas.map((s) => ({ ...s, concluido: true, concluidoEm: QUANDO }));
    const fixture = await createFixture(buildMocks(recalcularAgregados(tree)));

    el(fixture).querySelector<HTMLInputElement>('.prog__filtro input')!.click();
    await fixture.whenStable();

    expect(el(fixture).querySelector('.prog__state')?.textContent).toContain(
      'Nenhum subtema pendente',
    );
    expect(el(fixture).querySelectorAll('.prog__disciplina')).toHaveLength(0);
    expect(pctGeral(fixture)).toBe('100%');
  });
});

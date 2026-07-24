import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { ApiErrorDetail } from '../../core/http/api-error';
import type { DisciplinaTree } from '../planos/planos.models';
import { HistoricoQuestoes } from './historico-questoes';
import type { RegistroQuestoes } from './questoes.models';
import { QuestoesService } from './questoes.service';

/**
 * Histórico de registros (US-2, US-3): linhas com nomes resolvidos e taxa %,
 * filtros refazendo a busca com reset de página, guarda de staleness, edição
 * inline (taxa recalculada ao vivo, PATCH só com campos alterados, '' → null
 * desvincula subtema, sem mudanças cancela sem request), exclusão com confirm
 * (volta página se esvaziou) e erro do PATCH sem aplicar mudanças.
 */

const NOW = '2026-07-01T12:00:00.000Z';

function sub(id: string, temaId: string, nome: string) {
  return { id, temaId, nome, ordem: 1, duracaoEstimadaMin: null, createdAt: NOW, updatedAt: NOW };
}

function buildDisciplinas(): DisciplinaTree[] {
  return [
    {
      id: 'disc-pt',
      planoId: 'plano-1',
      nome: 'Português',
      ordem: 1,
      createdAt: NOW,
      updatedAt: NOW,
      temas: [
        {
          id: 'tema-sin',
          disciplinaId: 'disc-pt',
          nome: 'Sintaxe',
          ordem: 1,
          createdAt: NOW,
          updatedAt: NOW,
          subtemas: [sub('sub-1', 'tema-sin', 'Concordância'), sub('sub-2', 'tema-sin', 'Crase')],
        },
        {
          id: 'tema-mor',
          disciplinaId: 'disc-pt',
          nome: 'Morfologia',
          ordem: 2,
          createdAt: NOW,
          updatedAt: NOW,
          subtemas: [],
        },
      ],
    },
  ];
}

function buildRegistro(overrides: Partial<RegistroQuestoes> = {}): RegistroQuestoes {
  return {
    id: 'reg-1',
    alunoId: 'user-1',
    temaId: 'tema-sin',
    subtemaId: 'sub-1',
    data: '2026-07-01',
    total: 20,
    erros: 8,
    taxaErro: 0.4,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function paginated(
  data: RegistroQuestoes[],
  total = data.length,
  page = 1,
): Paginated<RegistroQuestoes> {
  return { data, page, pageSize: 10, total };
}

function apiError(
  status: number,
  code: string,
  message: string,
  details?: ApiErrorDetail[],
): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message, details } } });
}

interface ServiceMock {
  list: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function buildMock(): ServiceMock {
  return {
    list: vi.fn(() =>
      of(
        paginated([
          buildRegistro(),
          buildRegistro({ id: 'reg-2', temaId: 'tema-mor', subtemaId: null, total: 10, erros: 1, taxaErro: 0.1 }),
        ]),
      ),
    ),
    update: vi.fn((id: string) => of(buildRegistro({ id }))),
    remove: vi.fn(() => of(void 0)),
  };
}

async function createFixture(mock: ServiceMock): Promise<ComponentFixture<HistoricoQuestoes>> {
  TestBed.configureTestingModule({
    imports: [HistoricoQuestoes],
    providers: [{ provide: QuestoesService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(HistoricoQuestoes);
  fixture.componentRef.setInput('disciplinas', buildDisciplinas());
  fixture.componentRef.setInput('refresh', 0);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<HistoricoQuestoes>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function linhas(fixture: ComponentFixture<HistoricoQuestoes>): HTMLTableRowElement[] {
  return Array.from(el(fixture).querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

function botaoNaLinha(linha: HTMLTableRowElement, texto: string): HTMLButtonElement {
  const btn = Array.from(linha.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.trim().startsWith(texto),
  );
  if (!btn) throw new Error(`Botão "${texto}" não encontrado na linha`);
  return btn;
}

async function editarCampo(
  fixture: ComponentFixture<HistoricoQuestoes>,
  ariaLabel: string,
  valor: string,
): Promise<void> {
  const campo = el(fixture).querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${ariaLabel}"]`,
  )!;
  campo.value = valor;
  campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? 'change' : 'input'));
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HistoricoQuestoes — listagem e filtros', () => {
  it('renderiza linhas com nomes de tema/subtema e taxa em %', async () => {
    const fixture = await createFixture(buildMock());

    const rows = linhas(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Sintaxe');
    expect(rows[0].textContent).toContain('Concordância');
    expect(rows[0].textContent).toContain('40%');
    expect(rows[1].textContent).toContain('Morfologia');
    expect(rows[1].textContent).toContain('—'); // subtema null
    expect(rows[1].textContent).toContain('10%');
  });

  it('filtros refazem a busca com from/to crus e resetam a página', async () => {
    const mock = buildMock();
    mock.list.mockReturnValue(of(paginated([buildRegistro()], 25))); // 3 páginas
    const fixture = await createFixture(mock);

    // vai para a página 2…
    Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Próxima')!
      .click();
    await fixture.whenStable();
    expect(mock.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    const from = el(fixture).querySelector<HTMLInputElement>('#qhist-from')!;
    from.value = '2026-07-01';
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(mock.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 10,
      sort: '-data',
      temaId: undefined,
      from: '2026-07-01',
      to: undefined,
    });

    const tema = el(fixture).querySelector<HTMLSelectElement>('#qhist-tema')!;
    tema.value = 'tema-sin';
    tema.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(mock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, temaId: 'tema-sin', from: '2026-07-01' }),
    );
  });

  it('staleness: resposta atrasada de filtro antigo é descartada', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    const antiga$ = new Subject<Paginated<RegistroQuestoes>>();
    mock.list.mockReturnValueOnce(antiga$); // filtro 1: segurado
    mock.list.mockReturnValueOnce(
      of(paginated([buildRegistro({ id: 'reg-novo', total: 99, erros: 0, taxaErro: 0 })])),
    ); // filtro 2: imediato

    const from = el(fixture).querySelector<HTMLInputElement>('#qhist-from')!;
    from.value = '2026-06-01';
    from.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el(fixture).textContent).toContain('Carregando registros');

    const to = el(fixture).querySelector<HTMLInputElement>('#qhist-to')!;
    to.value = '2026-06-30';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el(fixture).textContent).toContain('99');

    // resposta antiga chega — não pode sobrescrever
    antiga$.next(paginated([buildRegistro({ id: 'reg-velho', total: 55, erros: 5, taxaErro: 0.09 })]));
    antiga$.complete();
    await fixture.whenStable();

    expect(el(fixture).textContent).toContain('99');
    expect(el(fixture).textContent).not.toContain('55');
  });
});

describe('HistoricoQuestoes — nomes do payload (regressão do review)', () => {
  it('temaNome/subtemaNome do payload têm prioridade sobre a árvore', async () => {
    const mock = buildMock();
    mock.list.mockReturnValue(
      of(
        paginated([
          buildRegistro({
            // árvore diz "Sintaxe"/"Concordância"; payload diverge (renomeado no backend)
            temaNome: 'Sintaxe (renomeado)',
            subtemaNome: 'Concordância verbal',
          }),
        ]),
      ),
    );
    const fixture = await createFixture(mock);

    const linha = linhas(fixture)[0];
    // igualdade exata: os nomes da árvore ("Sintaxe"/"Concordância") não vencem
    expect(linha.children[1].textContent?.trim()).toBe('Sintaxe (renomeado)');
    expect(linha.children[2].textContent?.trim()).toBe('Concordância verbal');
  });

  it('plano sem árvore carregada mas com nomes no payload → exibe os nomes (não "—")', async () => {
    const mock = buildMock();
    mock.list.mockReturnValue(
      of(
        paginated([
          buildRegistro({
            temaId: 'tema-outro-plano',
            subtemaId: 'sub-outro-plano',
            temaNome: 'Tema de outro plano',
            subtemaNome: 'Subtema de outro plano',
          }),
        ]),
      ),
    );
    const fixture = await createFixture(mock);

    const linha = linhas(fixture)[0];
    expect(linha.children[1].textContent?.trim()).toBe('Tema de outro plano');
    expect(linha.children[2].textContent?.trim()).toBe('Subtema de outro plano');
    expect(linha.textContent).not.toContain('—');
  });

  it('payload sem nomes → fallback para a árvore; ids desconhecidos sem nomes → "—"', async () => {
    const mock = buildMock();
    mock.list.mockReturnValue(
      of(
        paginated([
          buildRegistro(), // sem temaNome/subtemaNome → árvore resolve
          buildRegistro({ id: 'reg-x', temaId: 'tema-fantasma', subtemaId: 'sub-fantasma' }),
        ]),
      ),
    );
    const fixture = await createFixture(mock);

    const rows = linhas(fixture);
    expect(rows[0].children[1].textContent?.trim()).toBe('Sintaxe');
    expect(rows[0].children[2].textContent?.trim()).toBe('Concordância');
    expect(rows[1].children[1].textContent?.trim()).toBe('—');
    expect(rows[1].children[2].textContent?.trim()).toBe('—');
  });
});

describe('HistoricoQuestoes — validação ao vivo na edição (regressão do review)', () => {
  async function abrirEdicao(fixture: ComponentFixture<HistoricoQuestoes>): Promise<void> {
    botaoNaLinha(linhas(fixture)[0], 'Editar').click();
    await fixture.whenStable();
  }

  function campo(
    fixture: ComponentFixture<HistoricoQuestoes>,
    ariaLabel: string,
  ): HTMLInputElement {
    return el(fixture).querySelector<HTMLInputElement>(`[aria-label="${ariaLabel}"]`)!;
  }

  it('erros > total → mensagem no campo, aria-invalid/aria-describedby e Salvar desabilitado', async () => {
    const fixture = await createFixture(buildMock());
    await abrirEdicao(fixture);

    await editarCampo(fixture, 'Erros', '25'); // > total 20

    const erros = campo(fixture, 'Erros');
    expect(erros.getAttribute('aria-invalid')).toBe('true');
    expect(erros.getAttribute('aria-describedby')).toBe('qhist-edit-erros-erro');
    const msg = el(fixture).querySelector('#qhist-edit-erros-erro');
    expect(msg?.textContent?.trim()).toBe('Os erros não podem exceder o total.');
    expect(botaoNaLinha(linhas(fixture)[0], 'Salvar').disabled).toBe(true);
  });

  it('total < 1 → mensagem no campo de total com a mesma fiação de a11y', async () => {
    const fixture = await createFixture(buildMock());
    await abrirEdicao(fixture);

    await editarCampo(fixture, 'Total de questões', '0');

    const total = campo(fixture, 'Total de questões');
    expect(total.getAttribute('aria-invalid')).toBe('true');
    expect(total.getAttribute('aria-describedby')).toBe('qhist-edit-total-erro');
    expect(el(fixture).querySelector('#qhist-edit-total-erro')?.textContent?.trim()).toBe(
      'O total deve ser pelo menos 1.',
    );
    expect(botaoNaLinha(linhas(fixture)[0], 'Salvar').disabled).toBe(true);
  });

  it('data futura → mensagem no campo de data', async () => {
    const fixture = await createFixture(buildMock());
    await abrirEdicao(fixture);

    const d = new Date();
    d.setDate(d.getDate() + 1);
    const amanha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await editarCampo(fixture, 'Data do registro', amanha);

    const data = campo(fixture, 'Data do registro');
    expect(data.getAttribute('aria-invalid')).toBe('true');
    expect(data.getAttribute('aria-describedby')).toBe('qhist-edit-data-erro');
    expect(el(fixture).querySelector('#qhist-edit-data-erro')?.textContent?.trim()).toBe(
      'A data não pode ser futura.',
    );
    expect(botaoNaLinha(linhas(fixture)[0], 'Salvar').disabled).toBe(true);
  });

  it('corrigir o valor limpa a mensagem, remove os atributos aria e reabilita o Salvar', async () => {
    const fixture = await createFixture(buildMock());
    await abrirEdicao(fixture);

    await editarCampo(fixture, 'Erros', '25');
    expect(el(fixture).querySelector('#qhist-edit-erros-erro')).not.toBeNull();

    await editarCampo(fixture, 'Erros', '5');

    const erros = campo(fixture, 'Erros');
    expect(el(fixture).querySelector('#qhist-edit-erros-erro')).toBeNull();
    expect(erros.hasAttribute('aria-invalid')).toBe(false);
    expect(erros.hasAttribute('aria-describedby')).toBe(false);
    expect(botaoNaLinha(linhas(fixture)[0], 'Salvar').disabled).toBe(false);
    // taxa volta a ser exibida com o valor corrigido (5/20 = 25%)
    expect(linhas(fixture)[0].textContent).toContain('25%');
  });
});

describe('HistoricoQuestoes — edição inline', () => {
  it('recalcula a taxa na linha ao vivo e envia PATCH SÓ com os campos alterados', async () => {
    const mock = buildMock();
    mock.update.mockReturnValue(of(buildRegistro({ erros: 5, taxaErro: 0.25 })));
    const fixture = await createFixture(mock);
    const alterados: void[] = [];
    fixture.componentInstance.alterado.subscribe(() => alterados.push(void 0));

    botaoNaLinha(linhas(fixture)[0], 'Editar').click();
    await fixture.whenStable();

    // pré-preenchido e taxa original
    expect(linhas(fixture)[0].textContent).toContain('40%');
    await editarCampo(fixture, 'Erros', '5');
    // taxa recalculada ao vivo: 5/20 = 25%
    expect(linhas(fixture)[0].textContent).toContain('25%');

    botaoNaLinha(linhas(fixture)[0], 'Salvar').click();
    await fixture.whenStable();

    expect(mock.update).toHaveBeenCalledExactlyOnceWith('reg-1', { erros: 5 });
    // linha atualizada com a resposta e saiu do modo edição
    expect(linhas(fixture)[0].textContent).toContain('25%');
    expect(linhas(fixture)[0].querySelector('input')).toBeNull();
    expect(alterados).toHaveLength(1);
  });

  it('sem mudanças → Salvar cancela a edição sem request', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    botaoNaLinha(linhas(fixture)[0], 'Editar').click();
    await fixture.whenStable();
    botaoNaLinha(linhas(fixture)[0], 'Salvar').click();
    await fixture.whenStable();

    expect(mock.update).not.toHaveBeenCalled();
    expect(linhas(fixture)[0].querySelector('input')).toBeNull(); // fechou
  });

  it('subtema "" → PATCH com subtemaId: null (desvincula)', async () => {
    const mock = buildMock();
    mock.update.mockReturnValue(of(buildRegistro({ subtemaId: null })));
    const fixture = await createFixture(mock);

    botaoNaLinha(linhas(fixture)[0], 'Editar').click();
    await fixture.whenStable();
    await editarCampo(fixture, 'Subtema do registro', '');
    botaoNaLinha(linhas(fixture)[0], 'Salvar').click();
    await fixture.whenStable();

    expect(mock.update).toHaveBeenCalledExactlyOnceWith('reg-1', { subtemaId: null });
  });

  it('erros > total na edição desabilita o Salvar (invariantes RN-2)', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    botaoNaLinha(linhas(fixture)[0], 'Editar').click();
    await fixture.whenStable();
    await editarCampo(fixture, 'Erros', '25'); // > total 20

    expect(botaoNaLinha(linhas(fixture)[0], 'Salvar').disabled).toBe(true);
    expect(linhas(fixture)[0].textContent).toContain('—'); // taxa some
  });

  it('erro do PATCH exibe a mensagem (com issues) sem aplicar nem fechar a edição', async () => {
    const mock = buildMock();
    mock.update.mockReturnValue(
      throwError(() =>
        apiError(422, 'VALIDATION_ERROR', 'Verifique os dados informados.', [
          { field: 'erros', issue: 'erros não podem exceder o total' },
        ]),
      ),
    );
    const fixture = await createFixture(mock);

    botaoNaLinha(linhas(fixture)[0], 'Editar').click();
    await fixture.whenStable();
    await editarCampo(fixture, 'Erros', '10');
    botaoNaLinha(linhas(fixture)[0], 'Salvar').click();
    await fixture.whenStable();

    const alerta = el(fixture).querySelector('.alert--error');
    expect(alerta?.textContent).toContain('Verifique os dados informados.');
    expect(alerta?.textContent).toContain('erros não podem exceder o total');
    // continua editando (mudança não aplicada na linha)
    expect(linhas(fixture)[0].querySelector('input')).not.toBeNull();
  });
});

describe('HistoricoQuestoes — exclusão', () => {
  it('confirma → DELETE, recarrega e emite alterado', async () => {
    const mock = buildMock();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await createFixture(mock);
    const alterados: void[] = [];
    fixture.componentInstance.alterado.subscribe(() => alterados.push(void 0));
    const chamadas = mock.list.mock.calls.length;

    botaoNaLinha(linhas(fixture)[0], 'Excluir').click();
    await fixture.whenStable();

    expect(confirmSpy.mock.calls[0][0]).toContain('20 questões de 01/07/2026');
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith('reg-1');
    expect(mock.list.mock.calls.length).toBe(chamadas + 1);
    expect(alterados).toHaveLength(1);
  });

  it('última linha da página > 1 removida → volta uma página', async () => {
    const mock = buildMock();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // página 1 cheia (11 no total), página 2 com 1 item
    mock.list.mockReturnValueOnce(
      of(paginated(Array.from({ length: 10 }, (_, i) => buildRegistro({ id: `reg-${i}` })), 11)),
    );
    const fixture = await createFixture(mock);

    mock.list.mockReturnValueOnce(of(paginated([buildRegistro({ id: 'reg-11' })], 11, 2)));
    Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Próxima')!
      .click();
    await fixture.whenStable();
    expect(mock.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    mock.list.mockReturnValue(of(paginated([buildRegistro()], 10)));
    botaoNaLinha(linhas(fixture)[0], 'Excluir').click();
    await fixture.whenStable();

    expect(mock.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    expect(fixture.componentInstance.page()).toBe(1);
  });

  it('confirmação negada → não chama a API', async () => {
    const mock = buildMock();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await createFixture(mock);

    botaoNaLinha(linhas(fixture)[0], 'Excluir').click();
    await fixture.whenStable();

    expect(mock.remove).not.toHaveBeenCalled();
  });
});

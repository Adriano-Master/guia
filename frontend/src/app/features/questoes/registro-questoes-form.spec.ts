import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import type { ApiErrorDetail } from '../../core/http/api-error';
import type { DisciplinaTree } from '../planos/planos.models';
import type { RegistroQuestoes } from './questoes.models';
import { hojeLocal } from './questoes.models';
import { QuestoesService } from './questoes.service';
import { RegistroQuestoesForm } from './registro-questoes-form';

/**
 * Formulário de registro de questões (US-1, CA-1..CA-5): taxa de erro AO VIVO,
 * validações client-side bloqueando o POST (erros > total, total = 0, data
 * futura), payload correto no sucesso com feedback + output, 422 com details
 * no campo certo e seletores tema (optgroup por disciplina) / subtema
 * dependente do tema.
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
      ],
    },
    {
      id: 'disc-dir',
      planoId: 'plano-1',
      nome: 'Direito',
      ordem: 2,
      createdAt: NOW,
      updatedAt: NOW,
      temas: [
        {
          id: 'tema-con',
          disciplinaId: 'disc-dir',
          nome: 'Constitucional',
          ordem: 1,
          createdAt: NOW,
          updatedAt: NOW,
          subtemas: [sub('sub-3', 'tema-con', 'CF/88')],
        },
      ],
    },
    // disciplina sem temas não pode virar optgroup vazio
    {
      id: 'disc-vazia',
      planoId: 'plano-1',
      nome: 'Sem temas',
      ordem: 3,
      createdAt: NOW,
      updatedAt: NOW,
      temas: [],
    },
  ];
}

function buildRegistro(overrides: Partial<RegistroQuestoes> = {}): RegistroQuestoes {
  return {
    id: 'reg-1',
    alunoId: 'user-1',
    temaId: 'tema-sin',
    subtemaId: null,
    data: hojeLocal(),
    total: 20,
    erros: 8,
    taxaErro: 0.4,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
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
  create: ReturnType<typeof vi.fn>;
}

async function createFixture(
  service: ServiceMock,
): Promise<ComponentFixture<RegistroQuestoesForm>> {
  TestBed.configureTestingModule({
    imports: [RegistroQuestoesForm],
    providers: [{ provide: QuestoesService, useValue: service }],
  });
  const fixture = TestBed.createComponent(RegistroQuestoesForm);
  fixture.componentRef.setInput('disciplinas', buildDisciplinas());
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<RegistroQuestoesForm>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

async function digitar(
  fixture: ComponentFixture<RegistroQuestoesForm>,
  id: string,
  valor: string,
): Promise<void> {
  const input = el(fixture).querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = valor;
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

async function escolher(
  fixture: ComponentFixture<RegistroQuestoesForm>,
  id: string,
  valor: string,
): Promise<void> {
  const select = el(fixture).querySelector<HTMLSelectElement>(`#${id}`)!;
  select.value = valor;
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
}

async function registrar(fixture: ComponentFixture<RegistroQuestoesForm>): Promise<void> {
  const btn = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.includes('Registrar questões'),
  )!;
  btn.click();
  await fixture.whenStable();
}

function taxaTexto(fixture: ComponentFixture<RegistroQuestoesForm>): string {
  return el(fixture).querySelector('.qform__taxa')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function erroDoCampo(fixture: ComponentFixture<RegistroQuestoesForm>, inputId: string): string {
  const field = el(fixture).querySelector(`#${inputId}`)?.closest('.field');
  return field?.querySelector('.field__error')?.textContent?.trim() ?? '';
}

function amanha(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RegistroQuestoesForm — seletores tema/subtema', () => {
  it('temas agrupados em optgroup por disciplina; disciplina sem temas fica de fora', async () => {
    const fixture = await createFixture({ create: vi.fn() });

    const grupos = Array.from(
      el(fixture).querySelectorAll<HTMLOptGroupElement>('#qform-tema optgroup'),
    );
    expect(grupos.map((g) => g.label)).toEqual(['Português', 'Direito']);
    expect(
      Array.from(grupos[0].querySelectorAll('option')).map((o) => o.textContent?.trim()),
    ).toEqual(['Sintaxe']);
  });

  it('subtema desabilitado sem tema; filtrado pelo tema; troca de tema limpa a escolha', async () => {
    const fixture = await createFixture({ create: vi.fn() });
    const subtemaSelect = el(fixture).querySelector<HTMLSelectElement>('#qform-subtema')!;

    expect(subtemaSelect.disabled).toBe(true);

    await escolher(fixture, 'qform-tema', 'tema-sin');
    expect(subtemaSelect.disabled).toBe(false);
    expect(
      Array.from(subtemaSelect.querySelectorAll('option')).map((o) => o.textContent?.trim()),
    ).toEqual(['Sem subtema', 'Concordância', 'Crase']);

    await escolher(fixture, 'qform-subtema', 'sub-1');
    expect(fixture.componentInstance.subtemaId()).toBe('sub-1');

    await escolher(fixture, 'qform-tema', 'tema-con');
    expect(fixture.componentInstance.subtemaId()).toBe(''); // limpo na troca
    expect(
      Array.from(subtemaSelect.querySelectorAll('option')).map((o) => o.textContent?.trim()),
    ).toEqual(['Sem subtema', 'CF/88']);
  });
});

describe('RegistroQuestoesForm — taxa de erro AO VIVO', () => {
  it('20 total / 8 erros → 40% sem submit', async () => {
    const fixture = await createFixture({ create: vi.fn() });

    expect(taxaTexto(fixture)).toContain('informe total e erros');

    await digitar(fixture, 'qform-total', '20');
    await digitar(fixture, 'qform-erros', '8');

    expect(taxaTexto(fixture)).toBe('Taxa de erro: 40%');
  });

  it('0 erros → 0% (não cai no estado vazio)', async () => {
    const fixture = await createFixture({ create: vi.fn() });

    await digitar(fixture, 'qform-total', '20');
    await digitar(fixture, 'qform-erros', '0');

    expect(taxaTexto(fixture)).toBe('Taxa de erro: 0%');
  });

  it('erros > total mostra erro AO VIVO no campo, antes do submit', async () => {
    const fixture = await createFixture({ create: vi.fn() });

    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '12');

    expect(erroDoCampo(fixture, 'qform-erros')).toBe('Os erros não podem exceder o total.');
    expect(taxaTexto(fixture)).toContain('informe total e erros'); // sem taxa inválida
  });
});

describe('RegistroQuestoesForm — validações bloqueiam o POST', () => {
  it('erros > total → submit bloqueado ANTES de chamar a API', async () => {
    const service = { create: vi.fn() };
    const fixture = await createFixture(service);

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '12');
    await registrar(fixture);

    expect(service.create).not.toHaveBeenCalled();
    expect(erroDoCampo(fixture, 'qform-erros')).toBe('Os erros não podem exceder o total.');
  });

  it('total = 0 → bloqueado (CB-1)', async () => {
    const service = { create: vi.fn() };
    const fixture = await createFixture(service);

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await digitar(fixture, 'qform-total', '0');
    await digitar(fixture, 'qform-erros', '0');
    await registrar(fixture);

    expect(service.create).not.toHaveBeenCalled();
    expect(erroDoCampo(fixture, 'qform-total')).toBe('O total deve ser pelo menos 1.');
  });

  it('data futura → bloqueada, e o input tem max = hoje (CA-3)', async () => {
    const service = { create: vi.fn() };
    const fixture = await createFixture(service);

    expect(el(fixture).querySelector('#qform-data')?.getAttribute('max')).toBe(hojeLocal());

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await digitar(fixture, 'qform-data', amanha());
    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '2');
    await registrar(fixture);

    expect(service.create).not.toHaveBeenCalled();
    expect(erroDoCampo(fixture, 'qform-data')).toBe('A data não pode ser futura.');
  });

  it('sem tema → bloqueado com erro no seletor', async () => {
    const service = { create: vi.fn() };
    const fixture = await createFixture(service);

    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '2');
    await registrar(fixture);

    expect(service.create).not.toHaveBeenCalled();
    expect(erroDoCampo(fixture, 'qform-tema')).toBe('Selecione o tema.');
  });
});

describe('RegistroQuestoesForm — submit e erros do backend', () => {
  it('submit válido → POST com payload correto, feedback com a taxa e output criado', async () => {
    const service = {
      create: vi.fn(() => of(buildRegistro({ subtemaId: 'sub-1' }))),
    };
    const fixture = await createFixture(service);
    const criados: RegistroQuestoes[] = [];
    fixture.componentInstance.criado.subscribe((r) => criados.push(r));

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await escolher(fixture, 'qform-subtema', 'sub-1');
    await digitar(fixture, 'qform-total', '20');
    await digitar(fixture, 'qform-erros', '8');
    await registrar(fixture);

    expect(service.create).toHaveBeenCalledExactlyOnceWith({
      temaId: 'tema-sin',
      subtemaId: 'sub-1',
      data: hojeLocal(),
      total: 20,
      erros: 8,
    });
    const sucesso = el(fixture).querySelector('.alert--success');
    expect(sucesso?.getAttribute('role')).toBe('status');
    expect(sucesso?.textContent).toContain('20 questões, 8 erros (40% de erro)');
    expect(criados).toHaveLength(1);
    // campos numéricos limpos para o próximo lançamento
    expect(fixture.componentInstance.total()).toBeNull();
    expect(fixture.componentInstance.erros()).toBeNull();
  });

  it('sem subtema → payload envia subtemaId undefined (omitido no JSON)', async () => {
    const service = { create: vi.fn(() => of(buildRegistro())) };
    const fixture = await createFixture(service);

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '0');
    await registrar(fixture);

    expect(service.create).toHaveBeenCalledExactlyOnceWith({
      temaId: 'tema-sin',
      subtemaId: undefined,
      data: hojeLocal(),
      total: 10,
      erros: 0,
    });
  });

  it('422 com detail em "erros" renderiza no campo certo + mensagem geral', async () => {
    const service = {
      create: vi.fn(() =>
        throwError(() =>
          apiError(422, 'VALIDATION_ERROR', 'Verifique os dados informados.', [
            { field: 'erros', issue: 'erros não podem exceder o total' },
          ]),
        ),
      ),
    };
    const fixture = await createFixture(service);

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '5');
    await registrar(fixture);

    expect(erroDoCampo(fixture, 'qform-erros')).toBe('erros não podem exceder o total');
    const alerta = el(fixture).querySelector('.alert--error');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('Verifique os dados informados.');
    // campo destacado como inválido
    expect(
      el(fixture).querySelector('#qform-erros')?.closest('.field')?.classList,
    ).toContain('field--invalid');
  });

  it('botão desabilitado enquanto o POST está em voo', async () => {
    const create$ = new Subject<RegistroQuestoes>();
    const service = { create: vi.fn(() => create$) };
    const fixture = await createFixture(service);

    await escolher(fixture, 'qform-tema', 'tema-sin');
    await digitar(fixture, 'qform-total', '10');
    await digitar(fixture, 'qform-erros', '2');
    await registrar(fixture);

    const btn = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Registrando'),
    );
    expect(btn?.disabled).toBe(true);

    create$.next(buildRegistro({ total: 10, erros: 2, taxaErro: 0.2 }));
    create$.complete();
    await fixture.whenStable();
    expect(el(fixture).querySelector('.alert--success')).not.toBeNull();
  });
});

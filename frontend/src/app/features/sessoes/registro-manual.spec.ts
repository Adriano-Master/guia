import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import type { DisciplinaTree } from '../planos/planos.models';
import { RegistroManual } from './registro-manual';
import type { Sessao } from './sessoes.models';
import { SessaoService } from './sessoes.service';

/**
 * Testes de componente do registro manual (cronometro-e-sessoes, US-5):
 * validações de duracaoMin (CA-7: inteiro > 0) e de data (CB-4: não futura),
 * e o payload do POST /sessoes/manual no submit válido.
 * Observação: a UI não impõe teto de 1440 min — apenas inteiro > 0; um limite
 * superior, se existir, é aplicado pelo backend e exibido via serverError.
 */

const NOW = '2026-07-06T12:00:00.000Z';

function buildDisciplinas(): DisciplinaTree[] {
  return [
    {
      id: 'disc-1',
      planoId: 'plano-1',
      nome: 'Português',
      ordem: 1,
      createdAt: NOW,
      updatedAt: NOW,
      temas: [],
    },
  ];
}

function buildSessao(overrides: Partial<Sessao> = {}): Sessao {
  return {
    id: 'sessao-manual-1',
    alunoId: 'user-1',
    disciplinaId: 'disc-1',
    subtemaId: null,
    blocoId: null,
    origem: 'MANUAL',
    inicio: NOW,
    fim: NOW,
    duracaoMin: 45,
    estado: 'STOPPED',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Mesmo formato local YYYY-MM-DD usado pelo componente. */
function isoLocal(date: Date): string {
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mes}-${dia}`;
}

interface SessaoServiceMock {
  manual: ReturnType<typeof vi.fn>;
}

async function createFixture(
  service: SessaoServiceMock,
): Promise<ComponentFixture<RegistroManual>> {
  TestBed.configureTestingModule({
    imports: [RegistroManual],
    providers: [{ provide: SessaoService, useValue: service }],
  });
  const fixture = TestBed.createComponent(RegistroManual);
  fixture.componentRef.setInput('disciplinas', buildDisciplinas());
  await fixture.whenStable();
  return fixture;
}

async function submeter(fixture: ComponentFixture<RegistroManual>): Promise<void> {
  const botao = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ).find((b) => b.textContent?.includes('Registrar tempo'));
  expect(botao).toBeTruthy();
  botao!.click();
  await fixture.whenStable();
}

function fieldError(fixture: ComponentFixture<RegistroManual>): string {
  return (
    (fixture.nativeElement as HTMLElement).querySelector('.field__error')?.textContent?.trim() ??
    ''
  );
}

describe('RegistroManual — validação de duracaoMin (CA-7)', () => {
  const casosInvalidos: { rotulo: string; valor: number | null; erro: string }[] = [
    { rotulo: 'vazio (null)', valor: null, erro: 'Informe os minutos estudados.' },
    { rotulo: 'zero', valor: 0, erro: 'Os minutos devem ser maiores que zero.' },
    { rotulo: 'negativo', valor: -30, erro: 'Os minutos devem ser maiores que zero.' },
    { rotulo: 'decimal', valor: 2.5, erro: 'Use um número inteiro de minutos.' },
  ];

  for (const caso of casosInvalidos) {
    it(`bloqueia o submit com duracaoMin ${caso.rotulo}`, async () => {
      const service: SessaoServiceMock = { manual: vi.fn(() => of(buildSessao())) };
      const fixture = await createFixture(service);
      const component = fixture.componentInstance;

      component.disciplinaId.set('disc-1');
      component.duracaoMin.set(caso.valor);
      await submeter(fixture);

      expect(service.manual).not.toHaveBeenCalled();
      expect(fieldError(fixture)).toBe(caso.erro);
    });
  }

  it('bloqueia o submit com duracaoMin vazio vindo do input como string vazia', async () => {
    const service: SessaoServiceMock = { manual: vi.fn(() => of(buildSessao())) };
    const fixture = await createFixture(service);
    const component = fixture.componentInstance;

    component.disciplinaId.set('disc-1');
    // ngModel de input number entrega '' quando o campo é apagado
    component.duracaoMin.set('' as unknown as number);
    await submeter(fixture);

    expect(service.manual).not.toHaveBeenCalled();
    expect(fieldError(fixture)).toBe('Informe os minutos estudados.');
  });
});

describe('RegistroManual — validação de data (CB-4)', () => {
  it('bloqueia o submit com data futura', async () => {
    const service: SessaoServiceMock = { manual: vi.fn(() => of(buildSessao())) };
    const fixture = await createFixture(service);
    const component = fixture.componentInstance;

    component.disciplinaId.set('disc-1');
    component.duracaoMin.set(45);
    component.data.set(isoLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
    await submeter(fixture);

    expect(service.manual).not.toHaveBeenCalled();
    expect(fieldError(fixture)).toBe('A data não pode ser futura.');
  });

  it('bloqueia o submit com data vazia', async () => {
    const service: SessaoServiceMock = { manual: vi.fn(() => of(buildSessao())) };
    const fixture = await createFixture(service);
    const component = fixture.componentInstance;

    component.disciplinaId.set('disc-1');
    component.duracaoMin.set(45);
    component.data.set('');
    await submeter(fixture);

    expect(service.manual).not.toHaveBeenCalled();
    expect(fieldError(fixture)).toBe('Informe a data do estudo.');
  });

  it('aceita a data de hoje (fronteira)', async () => {
    const service: SessaoServiceMock = { manual: vi.fn(() => of(buildSessao())) };
    const fixture = await createFixture(service);
    const component = fixture.componentInstance;

    component.disciplinaId.set('disc-1');
    component.duracaoMin.set(45);
    component.data.set(isoLocal(new Date())); // valor default, explicitado aqui
    await submeter(fixture);

    expect(service.manual).toHaveBeenCalledTimes(1);
  });
});

describe('RegistroManual — submit válido (CA-6)', () => {
  it('chama POST /sessoes/manual com o payload correto e emite criada', async () => {
    const service: SessaoServiceMock = {
      manual: vi.fn(() => of(buildSessao({ duracaoMin: 45 }))),
    };
    const fixture = await createFixture(service);
    const component = fixture.componentInstance;

    const criadas: Sessao[] = [];
    component.criada.subscribe((s) => criadas.push(s));

    const ontem = isoLocal(new Date(Date.now() - 24 * 60 * 60 * 1000));
    component.disciplinaId.set('disc-1');
    component.data.set(ontem);
    component.duracaoMin.set(45);
    await submeter(fixture);

    expect(service.manual).toHaveBeenCalledTimes(1);
    expect(service.manual).toHaveBeenCalledWith({
      disciplinaId: 'disc-1',
      subtemaId: undefined,
      data: ontem,
      duracaoMin: 45,
    });
    expect(criadas).toHaveLength(1);
    expect(criadas[0].duracaoMin).toBe(45);

    // Feedback de sucesso e reset do campo de minutos
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.alert--success')?.textContent).toContain('45 min');
    expect(component.duracaoMin()).toBeNull();
  });

  it('exibe o erro do servidor (422) sem limpar o formulário', async () => {
    const service: SessaoServiceMock = {
      manual: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 422,
              error: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Verifique os dados informados.',
                  details: [{ field: 'duracaoMin', issue: 'duração acima do limite diário' }],
                },
              },
            }),
        ),
      ),
    };
    const fixture = await createFixture(service);
    const component = fixture.componentInstance;

    component.disciplinaId.set('disc-1');
    component.duracaoMin.set(2000);
    await submeter(fixture);

    const alerta = fixture.nativeElement.querySelector('.alert--error');
    expect(alerta?.textContent).toContain('Verifique os dados informados.');
    expect(alerta?.textContent).toContain('duração acima do limite diário');
    expect(component.duracaoMin()).toBe(2000);
  });
});

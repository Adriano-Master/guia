import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import type { DisciplinaTree } from '../planos/planos.models';
import { Cronometro } from './cronometro';
import type { Sessao, SessaoEstado } from './sessoes.models';
import { SessaoService } from './sessoes.service';

/**
 * Testes de componente do cronômetro (cronometro-e-sessoes, US-1..US-4):
 * máquina de estados RUNNING/PAUSED, reidratação via GET /sessoes/ativa
 * (CB-3), acúmulo LOCAL de pausa enviado como pausaMin no stop (D-3),
 * 409 no start com oferta de reidratar e descarte com confirmação.
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
      temas: [
        {
          id: 'tema-1',
          disciplinaId: 'disc-1',
          nome: 'Sintaxe',
          ordem: 1,
          createdAt: NOW,
          updatedAt: NOW,
          subtemas: [
            {
              id: 'sub-1',
              temaId: 'tema-1',
              nome: 'Concordância',
              ordem: 1,
              duracaoEstimadaMin: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        },
      ],
    },
  ];
}

function buildSessao(overrides: Partial<Sessao> = {}): Sessao {
  return {
    id: 'sessao-1',
    alunoId: 'user-1',
    disciplinaId: 'disc-1',
    subtemaId: null,
    blocoId: null,
    origem: 'CRONOMETRO',
    inicio: NOW,
    fim: null,
    duracaoMin: 0,
    estado: 'RUNNING' as SessaoEstado,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function apiError(status: number, code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error: { code, message } } });
}

const erro404 = () =>
  throwError(() => apiError(404, 'NOT_FOUND', 'Não há cronômetro em andamento.'));

interface SessaoServiceMock {
  start: ReturnType<typeof vi.fn>;
  getAtiva: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  discard: ReturnType<typeof vi.fn>;
}

function buildServiceMock(): SessaoServiceMock {
  return {
    start: vi.fn(() => of(buildSessao())),
    getAtiva: vi.fn(() => erro404()),
    pause: vi.fn(() => of(buildSessao())),
    resume: vi.fn(() => of(buildSessao())),
    stop: vi.fn(() => of(buildSessao({ estado: 'STOPPED', fim: NOW, duracaoMin: 25 }))),
    discard: vi.fn(() => of(void 0)),
  };
}

async function createFixture(service: SessaoServiceMock): Promise<ComponentFixture<Cronometro>> {
  TestBed.configureTestingModule({
    imports: [Cronometro],
    providers: [
      { provide: SessaoService, useValue: service },
      // O estado do cronômetro vive no SessaoAtivaService (root), que integra
      // com o AuthService (hidrata no login de ALUNO, limpa no logout). Um
      // ALUNO autenticado reproduz o cenário original destes testes (a página
      // é exclusiva de aluno) sem puxar o AuthService real (HttpClient/Router).
      {
        provide: AuthService,
        useValue: { isAuthenticated: () => true, role: () => 'ALUNO' as const },
      },
    ],
  });
  const fixture = TestBed.createComponent(Cronometro);
  fixture.componentRef.setInput('disciplinas', buildDisciplinas());
  await fixture.whenStable();
  return fixture;
}

function buttonByText(fixture: ComponentFixture<Cronometro>, texto: string): HTMLButtonElement {
  const buttons = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  );
  const alvo = buttons.find((b) => b.textContent?.trim().startsWith(texto));
  if (!alvo) {
    throw new Error(
      `Botão "${texto}" não encontrado. Presentes: ${buttons.map((b) => b.textContent?.trim()).join(' | ')}`,
    );
  }
  return alvo;
}

async function click(fixture: ComponentFixture<Cronometro>, texto: string): Promise<void> {
  buttonByText(fixture, texto).click();
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cronometro — reidratação (CB-3)', () => {
  it('GET /sessoes/ativa 200 RUNNING → mostra o timer em andamento', async () => {
    const service = buildServiceMock();
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'RUNNING' })));
    const fixture = await createFixture(service);

    expect(service.getAtiva).toHaveBeenCalledTimes(1);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.crono__display')).not.toBeNull();
    expect(element.querySelector('.crono__estado')?.textContent).toContain('Em andamento');
    // Estado RUNNING oferece "Pausar" (não "Retomar")
    expect(buttonByText(fixture, 'Pausar')).toBeTruthy();
    expect(element.querySelector('.crono__display--pausado')).toBeNull();
    expect(element.querySelector('.crono__alvo')?.textContent).toContain('Português');
  });

  it('GET /sessoes/ativa 200 PAUSED → mostra o timer pausado com ação de retomar', async () => {
    const service = buildServiceMock();
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'PAUSED' })));
    const fixture = await createFixture(service);

    expect(fixture.componentInstance.pausado()).toBe(true);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.crono__estado')?.textContent).toContain('Pausado');
    expect(element.querySelector('.crono__display--pausado')).not.toBeNull();
    expect(buttonByText(fixture, 'Retomar')).toBeTruthy();
  });

  it('GET /sessoes/ativa 404 → mostra o formulário de start limpo, sem erro', async () => {
    const service = buildServiceMock();
    const fixture = await createFixture(service);

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.crono__display')).toBeNull();
    expect(element.querySelector('.alert--error')).toBeNull();
    const select = element.querySelector<HTMLSelectElement>('#crono-disciplina');
    expect(select).not.toBeNull();
    expect(select!.value).toBe('');
    expect(buttonByText(fixture, 'Iniciar cronômetro')).toBeTruthy();
  });
});

describe('Cronometro — start (US-1, RN-1)', () => {
  it('start feliz muda para RUNNING', async () => {
    const service = buildServiceMock();
    const fixture = await createFixture(service);

    fixture.componentInstance.disciplinaId.set('disc-1');
    await click(fixture, 'Iniciar cronômetro');

    expect(service.start).toHaveBeenCalledWith({
      disciplinaId: 'disc-1',
      subtemaId: undefined,
      blocoId: undefined,
    });
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.crono__display')).not.toBeNull();
    expect(element.querySelector('.crono__estado')?.textContent).toContain('Em andamento');
  });

  it('start sem disciplina não chama a API e mostra erro de campo', async () => {
    const service = buildServiceMock();
    const fixture = await createFixture(service);

    await click(fixture, 'Iniciar cronômetro');

    expect(service.start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.field__error')?.textContent).toContain(
      'Selecione a disciplina',
    );
  });

  it('start com 409 exibe mensagem e ação de ir ao cronômetro em andamento', async () => {
    const service = buildServiceMock();
    service.start.mockReturnValue(
      throwError(() => apiError(409, 'CONFLICT', 'Já existe um cronômetro em andamento.')),
    );
    const fixture = await createFixture(service);

    fixture.componentInstance.disciplinaId.set('disc-1');
    await click(fixture, 'Iniciar cronômetro');

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.alert--error')?.textContent).toContain(
      'Já há um cronômetro em andamento.',
    );

    // A ação oferecida reidrata a sessão em andamento (um cronômetro por vez)
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'RUNNING' })));
    await click(fixture, 'Ir para o cronômetro em andamento');

    expect(service.getAtiva).toHaveBeenCalledTimes(2); // construtor + reidratação sob demanda
    expect(element.querySelector('.crono__display')).not.toBeNull();
    expect(element.querySelector('.alert--error')).toBeNull();
  });
});

describe('Cronometro — pausa local e stop (D-3, CA-3)', () => {
  it('pause → resume acumula pausa local e o stop envia pausaMin arredondado', async () => {
    const service = buildServiceMock();
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'RUNNING' })));
    const fixture = await createFixture(service);

    const finalizadas: Sessao[] = [];
    fixture.componentInstance.finalizada.subscribe((s) => finalizadas.push(s));

    const t0 = new Date(NOW).getTime();
    const nowSpy = vi.spyOn(Date, 'now');

    // 1ª pausa: 60 s
    nowSpy.mockReturnValue(t0);
    await click(fixture, 'Pausar');
    expect(service.pause).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.pausado()).toBe(true);

    nowSpy.mockReturnValue(t0 + 60_000);
    await click(fixture, 'Retomar');
    expect(service.resume).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.pausado()).toBe(false);

    // 2ª pausa: 90 s → total 150 s = 2,5 min → Math.round = 3
    nowSpy.mockReturnValue(t0 + 120_000);
    await click(fixture, 'Pausar');
    nowSpy.mockReturnValue(t0 + 210_000);
    await click(fixture, 'Retomar');

    await click(fixture, 'Parar e registrar');

    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(service.stop).toHaveBeenCalledWith(3);

    // Após o stop, volta ao formulário e confirma o registro
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.crono__display')).toBeNull();
    expect(element.querySelector('.alert--success')?.textContent).toContain('25 min');
    expect(finalizadas).toHaveLength(1);
    expect(finalizadas[0].duracaoMin).toBe(25);
  });

  it('stop sem nenhuma pausa envia pausaMin = 0', async () => {
    const service = buildServiceMock();
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'RUNNING' })));
    const fixture = await createFixture(service);

    await click(fixture, 'Parar e registrar');

    expect(service.stop).toHaveBeenCalledWith(0);
  });
});

describe('Cronometro — descartar (US-4)', () => {
  it('pede confirmação e chama DELETE /sessoes/ativa quando confirmado', async () => {
    const service = buildServiceMock();
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'RUNNING' })));
    const fixture = await createFixture(service);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(fixture, 'Descartar');

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('NÃO será registrado');
    expect(service.discard).toHaveBeenCalledTimes(1);
    // Cronômetro limpo → volta ao formulário de start
    expect(fixture.nativeElement.querySelector('.crono__display')).toBeNull();
    expect(fixture.nativeElement.querySelector('#crono-disciplina')).not.toBeNull();
  });

  it('não descarta quando a confirmação é negada', async () => {
    const service = buildServiceMock();
    service.getAtiva.mockReturnValue(of(buildSessao({ estado: 'RUNNING' })));
    const fixture = await createFixture(service);

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(fixture, 'Descartar');

    expect(service.discard).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.crono__display')).not.toBeNull();
  });
});

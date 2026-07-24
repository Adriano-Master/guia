import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import type { HorasPorDisciplina, ResumoEstatisticas, SerieTemporal } from './estatisticas.models';
import EstatisticasPage from './estatisticas-page';
import { EstatisticasService } from './estatisticas.service';

/**
 * Dashboard de estatísticas: cartões de resumo com números-herói em texto,
 * anel de progresso, painéis de gráficos/tabela quando há dados, CTA de
 * vazio quando o aluno não registrou nada, e estados de carregamento/erro.
 */

function buildResumo(overrides: Partial<ResumoEstatisticas> = {}): ResumoEstatisticas {
  return {
    horasTotais: 12.5,
    progresso: { percentual: 25, concluidos: 3, totalSubtemas: 12 },
    questoes: { total: 40, erros: 10, taxaErro: 0.25 },
    ...overrides,
  };
}

const RESUMO_VAZIO: ResumoEstatisticas = {
  horasTotais: 0,
  progresso: { percentual: 0, concluidos: 0, totalSubtemas: 12 },
  questoes: { total: 0, erros: 0, taxaErro: 0 },
};

function buildHoras(): HorasPorDisciplina {
  return {
    data: [{ disciplinaId: 'd1', disciplina: 'Português', horas: 12.5 }],
    totalHoras: 12.5,
  };
}

function buildSerie(): SerieTemporal {
  return {
    granularidade: 'dia',
    from: '2026-07-01',
    to: '2026-07-02',
    timezone: 'America/Sao_Paulo',
    data: [
      { bucket: '2026-07-01', horas: 2 },
      { bucket: '2026-07-02', horas: 0.5 },
    ],
  };
}

interface ServiceMock {
  resumo: ReturnType<typeof vi.fn>;
  horasPorDisciplina: ReturnType<typeof vi.fn>;
  serieTemporal: ReturnType<typeof vi.fn>;
  progresso: ReturnType<typeof vi.fn>;
  desempenhoQuestoes: ReturnType<typeof vi.fn>;
}

function buildMock(resumo: ResumoEstatisticas = buildResumo()): ServiceMock {
  return {
    resumo: vi.fn(() => of(resumo)),
    horasPorDisciplina: vi.fn(() => of(buildHoras())),
    serieTemporal: vi.fn(() => of(buildSerie())),
    progresso: vi.fn(() => of({ percentual: 25, concluidos: 3, totalSubtemas: 12 })),
    desempenhoQuestoes: vi.fn(() =>
      of({
        total: 40,
        erros: 10,
        taxaErro: 0.25,
        data: [{ disciplinaId: 'd1', nome: 'Português', total: 40, erros: 10, taxaErro: 0.25 }],
      }),
    ),
  };
}

async function createFixture(mock: ServiceMock): Promise<ComponentFixture<EstatisticasPage>> {
  TestBed.configureTestingModule({
    imports: [EstatisticasPage],
    providers: [provideRouter([]), { provide: EstatisticasService, useValue: mock }],
  });
  const fixture = TestBed.createComponent(EstatisticasPage);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<EstatisticasPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EstatisticasPage — cartões de resumo', () => {
  it('exibe horas totais, progresso (anel + contagem) e questões', async () => {
    const mock = buildMock();
    const fixture = await createFixture(mock);

    expect(mock.resumo).toHaveBeenCalledTimes(1);
    expect(mock.horasPorDisciplina).toHaveBeenCalledExactlyOnceWith();

    const heroes = Array.from(el(fixture).querySelectorAll('.stats__hero')).map((hero) =>
      hero.textContent?.trim(),
    );
    expect(heroes).toEqual(['12.5 h', '40']);

    const anel = el(fixture).querySelector('app-anel-progresso [role="img"]')!;
    expect(anel.getAttribute('aria-label')).toBe(
      'Progresso do plano ativo: 3 de 12 subtemas concluídos',
    );
    expect(el(fixture).querySelector('.anel__valor')?.textContent?.trim()).toBe('25%');

    expect(el(fixture).textContent).toContain('3 de 12 subtemas');
    expect(el(fixture).textContent).toContain('10 erros — taxa de 25%');
  });
});

describe('EstatisticasPage — painéis', () => {
  it('com dados: renderiza barras (com as horas carregadas), série temporal e tabela', async () => {
    const fixture = await createFixture(buildMock());

    expect(el(fixture).querySelector('app-grafico-barras-horas')).not.toBeNull();
    expect(el(fixture).querySelector('.gbar__nome')?.textContent?.trim()).toBe('Português');
    expect(el(fixture).querySelector('app-grafico-serie-temporal')).not.toBeNull();
    expect(el(fixture).querySelector('app-tabela-desempenho-questoes')).not.toBeNull();
    expect(el(fixture).querySelector('.stats__empty')).toBeNull();
  });

  it('aluno sem dados: CTA no lugar dos gráficos, cartões zerados visíveis', async () => {
    const mock = buildMock(RESUMO_VAZIO);
    const fixture = await createFixture(mock);

    expect(el(fixture).querySelector('.stats__empty')).not.toBeNull();
    expect(el(fixture).textContent).toContain('Você ainda não tem dados por aqui.');
    expect(el(fixture).querySelector('.stats__empty a')?.getAttribute('href')).toBe('/sessoes');
    expect(el(fixture).querySelector('app-grafico-serie-temporal')).toBeNull();
    // cartões seguem mostrando os zeros (informativos)
    expect(
      Array.from(el(fixture).querySelectorAll('.stats__hero')).map((h) => h.textContent?.trim()),
    ).toEqual(['0 h', '0']);
    // gráficos nem chegam a buscar dados
    expect(mock.serieTemporal).not.toHaveBeenCalled();
    expect(mock.desempenhoQuestoes).not.toHaveBeenCalled();
  });

  it('progresso sem sessões/questões ainda conta como dado (não mostra o CTA)', async () => {
    const fixture = await createFixture(
      buildMock(
        buildResumo({
          horasTotais: 0,
          progresso: { percentual: 25, concluidos: 3, totalSubtemas: 12 },
          questoes: { total: 0, erros: 0, taxaErro: 0 },
        }),
      ),
    );

    expect(el(fixture).querySelector('.stats__empty')).toBeNull();
    expect(el(fixture).querySelector('app-grafico-serie-temporal')).not.toBeNull();
  });
});

describe('EstatisticasPage — carregamento e erro', () => {
  it('mostra o estado de carregamento enquanto o resumo não chega', async () => {
    const mock = buildMock();
    mock.resumo.mockReturnValue(new Subject());
    const fixture = await createFixture(mock);

    expect(el(fixture).textContent).toContain('Carregando estatísticas…');
    expect(el(fixture).querySelector('.stats__cards')).toBeNull();
  });

  it('erro da API vira alerta com a mensagem do envelope padrão', async () => {
    const mock = buildMock();
    mock.resumo.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            error: { error: { code: 'INTERNAL', message: 'Erro inesperado no servidor.' } },
          }),
      ),
    );
    const fixture = await createFixture(mock);

    const alerta = el(fixture).querySelector('[role="alert"]')!;
    expect(alerta.textContent).toContain('Erro inesperado no servidor.');
    expect(el(fixture).querySelector('.stats__cards')).toBeNull();
  });
});

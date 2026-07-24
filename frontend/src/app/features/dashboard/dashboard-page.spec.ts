import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import type { Bloco, Cronograma } from '../cronograma/cronograma.models';
import { CronogramaService } from '../cronograma/cronograma.service';
import type { ResumoEstatisticas } from '../estatisticas/estatisticas.models';
import { EstatisticasService } from '../estatisticas/estatisticas.service';
import type { MinhaPontuacao } from '../gamificacao/gamificacao.models';
import { RankingService } from '../gamificacao/ranking.service';
import type { PlanoTree } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import type { Sessao } from '../sessoes/sessoes.models';
import { SessaoService } from '../sessoes/sessoes.service';
import DashboardPage from './dashboard-page';

/**
 * Dashboard do aluno: tiles de resumo (horas, questões, ranking), painel de
 * progresso do plano, "Hoje no cronograma" (com nomes de disciplina resolvidos
 * pela árvore do plano) e banner de sessão ativa. Falhas parciais (ranking,
 * cronograma ou sessão 404) não podem derrubar a página — só o resumo é vital.
 */

function buildResumo(overrides: Partial<ResumoEstatisticas> = {}): ResumoEstatisticas {
  return {
    horasTotais: 12.5,
    progresso: { percentual: 25, concluidos: 3, totalSubtemas: 12 },
    questoes: { total: 40, erros: 10, taxaErro: 0.25 },
    ...overrides,
  };
}

function buildPontuacao(overrides: Partial<MinhaPontuacao> = {}): MinhaPontuacao {
  return {
    posicaoGlobal: 3,
    pontos: 350,
    subtemasConcluidos: 3,
    horasEstudadas: 12.5,
    semanasConsistentes: 2,
    composicao: { pontosSubtemas: 300, pontosHoras: 25, pontosBonus: 25 },
    turmas: [],
    ...overrides,
  };
}

function buildCronograma(overrides: Partial<Cronograma> = {}): Cronograma {
  return {
    id: 'c1',
    alunoId: 'a1',
    planoId: 'p1',
    diasSemana: [1, 3, 5],
    janelas: [{ dia: 1, inicio: '08:00', fim: '12:00' }],
    horasSemanaTotal: 12,
    granularidadeMin: 60,
    timezone: 'America/Sao_Paulo',
    ativo: true,
    geradoEm: '2026-07-20T12:00:00.000Z',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

/** ISO-8601 do dia de hoje no horário local informado (o DatePipe reexibe em local). */
function isoHoje(horas: number, minutos = 0): string {
  const d = new Date();
  d.setHours(horas, minutos, 0, 0);
  return d.toISOString();
}

function buildBloco(overrides: Partial<Bloco> = {}): Bloco {
  return {
    id: 'b1',
    cronogramaId: 'c1',
    disciplinaId: 'd1',
    subtemaId: null,
    inicio: isoHoje(8),
    fim: isoHoje(9),
    duracaoMin: 60,
    status: 'PLANEJADO',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

function buildPlanoTree(): PlanoTree {
  const base = { createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-20T12:00:00.000Z' };
  return {
    id: 'p1',
    titulo: 'Plano TRT',
    descricao: null,
    tipo: 'OFICIAL',
    autorId: 'admin1',
    planoOrigemId: null,
    publicado: true,
    ...base,
    disciplinas: [
      { id: 'd1', planoId: 'p1', nome: 'Português', ordem: 1, temas: [], ...base },
      { id: 'd2', planoId: 'p1', nome: 'Matemática', ordem: 2, temas: [], ...base },
    ],
    pesos: [],
  };
}

function buildSessao(overrides: Partial<Sessao> = {}): Sessao {
  return {
    id: 's1',
    alunoId: 'a1',
    disciplinaId: 'd1',
    subtemaId: null,
    blocoId: null,
    origem: 'CRONOMETRO',
    inicio: isoHoje(7),
    fim: null,
    duracaoMin: 0,
    estado: 'RUNNING',
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
    ...overrides,
  };
}

function http404() {
  return throwError(
    () =>
      new HttpErrorResponse({
        status: 404,
        error: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } },
      }),
  );
}

interface Mocks {
  estatisticas: { resumo: ReturnType<typeof vi.fn> };
  ranking: { me: ReturnType<typeof vi.fn> };
  cronograma: { getAtivo: ReturnType<typeof vi.fn>; listBlocos: ReturnType<typeof vi.fn> };
  planos: { get: ReturnType<typeof vi.fn> };
  sessao: { getAtiva: ReturnType<typeof vi.fn> };
}

/** Cenário padrão: resumo e ranking ok; sem cronograma ativo nem sessão ativa (404). */
function buildMocks(): Mocks {
  return {
    estatisticas: { resumo: vi.fn(() => of(buildResumo())) },
    ranking: { me: vi.fn(() => of(buildPontuacao())) },
    cronograma: { getAtivo: vi.fn(() => http404()), listBlocos: vi.fn(() => of([] as Bloco[])) },
    planos: { get: vi.fn(() => of(buildPlanoTree())) },
    sessao: { getAtiva: vi.fn(() => http404()) },
  };
}

async function createFixture(mocks: Mocks): Promise<ComponentFixture<DashboardPage>> {
  TestBed.configureTestingModule({
    imports: [DashboardPage],
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: {
          currentUser: signal({ id: 'a1', nome: 'Maria Souza', email: 'maria@x.com', role: 'ALUNO' }),
        },
      },
      { provide: EstatisticasService, useValue: mocks.estatisticas },
      { provide: RankingService, useValue: mocks.ranking },
      { provide: CronogramaService, useValue: mocks.cronograma },
      { provide: PlanosService, useValue: mocks.planos },
      { provide: SessaoService, useValue: mocks.sessao },
    ],
  });
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<DashboardPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function tiles(fixture: ComponentFixture<DashboardPage>): string[] {
  return Array.from(el(fixture).querySelectorAll('.dash__tile')).map(
    (tile) => tile.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardPage — tiles de resumo', () => {
  it('exibe horas formatadas, questões com % de acerto e pontos com posição no ranking', async () => {
    const mocks = buildMocks();
    const fixture = await createFixture(mocks);

    expect(mocks.estatisticas.resumo).toHaveBeenCalledTimes(1);
    expect(mocks.ranking.me).toHaveBeenCalledTimes(1);

    expect(el(fixture).textContent).toContain('Olá, Maria!');

    const [horas, questoes, ranking] = tiles(fixture);
    // 12.5 h → "12h30"
    expect(horas).toContain('12h30');
    // 40 questões, taxaErro 0.25 → 75% de acerto
    expect(questoes).toContain('40');
    expect(questoes).toContain('75% de acerto');
    expect(ranking).toContain('350');
    expect(ranking).toContain('3º no ranking global');
  });

  it('horas cheias não mostram minutos ("8h", sem "8h00")', async () => {
    const mocks = buildMocks();
    mocks.estatisticas.resumo.mockReturnValue(of(buildResumo({ horasTotais: 8 })));
    const fixture = await createFixture(mocks);

    const [horas] = tiles(fixture);
    expect(horas).toContain('8h');
    expect(horas).not.toContain('8h00');
  });

  it('arredondamento de minutos não produz "1h60" (1.9917h → "2h")', async () => {
    const mocks = buildMocks();
    mocks.estatisticas.resumo.mockReturnValue(of(buildResumo({ horasTotais: 1.9917 })));
    const fixture = await createFixture(mocks);

    const [horas] = tiles(fixture);
    expect(horas).toContain('2h');
    expect(horas).not.toContain('1h60');
  });

  it('posicaoGlobal null → "Ainda fora do ranking"; 0 questões → "Nenhuma registrada ainda"', async () => {
    const mocks = buildMocks();
    mocks.estatisticas.resumo.mockReturnValue(
      of(buildResumo({ questoes: { total: 0, erros: 0, taxaErro: 0 } })),
    );
    mocks.ranking.me.mockReturnValue(of(buildPontuacao({ posicaoGlobal: null, pontos: 0 })));
    const fixture = await createFixture(mocks);

    const [, questoes, ranking] = tiles(fixture);
    expect(questoes).toContain('Nenhuma registrada ainda');
    expect(questoes).not.toContain('% de acerto');
    expect(ranking).toContain('Ainda fora do ranking');
  });
});

describe('DashboardPage — erro e resiliência', () => {
  it('resumo falhando → alerta com a mensagem do envelope e nenhum tile', async () => {
    const mocks = buildMocks();
    mocks.estatisticas.resumo.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            error: { error: { code: 'INTERNAL', message: 'Erro inesperado no servidor.' } },
          }),
      ),
    );
    const fixture = await createFixture(mocks);

    const alerta = el(fixture).querySelector('[role="alert"]')!;
    expect(alerta).not.toBeNull();
    expect(alerta.textContent).toContain('Erro inesperado no servidor.');
    expect(el(fixture).querySelector('.dash__tiles')).toBeNull();
  });

  it('404 em ranking, cronograma e sessão NÃO derruba a página (graceful degradation)', async () => {
    const mocks = buildMocks();
    mocks.ranking.me.mockReturnValue(http404());
    // cronograma e sessão já são 404 no cenário padrão
    const fixture = await createFixture(mocks);

    expect(el(fixture).querySelector('[role="alert"]')).toBeNull();
    // tiles do resumo seguem visíveis; ranking degrada para zero/fora do ranking
    const [horas, , ranking] = tiles(fixture);
    expect(horas).toContain('12h30');
    expect(ranking).toContain('0');
    expect(ranking).toContain('Ainda fora do ranking');
    // sem cronograma → CTA de criação
    const cta = el(fixture).querySelector('.dash__empty a')!;
    expect(cta.textContent?.trim()).toBe('Criar cronograma');
    expect(cta.getAttribute('href')).toBe('/cronograma');
    // sem sessão ativa → sem banner
    expect(el(fixture).querySelector('.dash__sessao')).toBeNull();
    // sem cronograma, nem tenta buscar plano/blocos
    expect(mocks.planos.get).not.toHaveBeenCalled();
    expect(mocks.cronograma.listBlocos).not.toHaveBeenCalled();
  });
});

describe('DashboardPage — hoje no cronograma', () => {
  it('renderiza blocos de hoje em ordem de início, com nome da disciplina e status label', async () => {
    const mocks = buildMocks();
    mocks.cronograma.getAtivo.mockReturnValue(of(buildCronograma()));
    // devolvidos fora de ordem de propósito — o componente deve ordenar por início
    mocks.cronograma.listBlocos.mockReturnValue(
      of([
        buildBloco({
          id: 'b2',
          disciplinaId: 'd2',
          inicio: isoHoje(10),
          fim: isoHoje(11),
          status: 'CONCLUIDO',
        }),
        buildBloco({ id: 'b1', disciplinaId: 'd1', inicio: isoHoje(8), fim: isoHoje(9) }),
        buildBloco({
          id: 'b3',
          disciplinaId: 'd1',
          inicio: isoHoje(12),
          fim: isoHoje(13),
          status: 'PULADO',
        }),
      ]),
    );
    const fixture = await createFixture(mocks);

    expect(mocks.planos.get).toHaveBeenCalledExactlyOnceWith('p1');
    expect(mocks.cronograma.listBlocos).toHaveBeenCalledTimes(1);
    expect(mocks.cronograma.listBlocos.mock.calls[0][0]).toBe('c1');

    const linhas = Array.from(el(fixture).querySelectorAll('.dash__bloco'));
    expect(linhas).toHaveLength(3);

    const horarios = linhas.map(
      (li) => li.querySelector('.dash__bloco-horario')?.textContent?.replace(/\s+/g, '').trim(),
    );
    expect(horarios).toEqual(['08:00–09:00', '10:00–11:00', '12:00–13:00']);

    const disciplinas = linhas.map(
      (li) => li.querySelector('.dash__bloco-disciplina')?.textContent?.trim(),
    );
    expect(disciplinas).toEqual(['Português', 'Matemática', 'Português']);

    const statuses = linhas.map(
      (li) => li.querySelector('.dash__bloco-status')?.textContent?.trim(),
    );
    expect(statuses).toEqual(['Planejado', 'Concluído', 'Pulado']);
    expect(linhas[1].querySelector('.dash__bloco-status--concluido')).not.toBeNull();
    expect(linhas[2].querySelector('.dash__bloco-status--pulado')).not.toBeNull();
  });

  it('cronograma ativo sem blocos hoje → mensagem de vazio com link para o calendário', async () => {
    const mocks = buildMocks();
    mocks.cronograma.getAtivo.mockReturnValue(of(buildCronograma()));
    mocks.cronograma.listBlocos.mockReturnValue(of([]));
    const fixture = await createFixture(mocks);

    expect(el(fixture).textContent).toContain('Nenhum bloco de estudo planejado para hoje.');
    expect(el(fixture).querySelector('.dash__blocos')).toBeNull();
  });

  it('plano indisponível (404) → blocos ainda aparecem com fallback "Disciplina"', async () => {
    const mocks = buildMocks();
    mocks.cronograma.getAtivo.mockReturnValue(of(buildCronograma()));
    mocks.planos.get.mockReturnValue(http404());
    mocks.cronograma.listBlocos.mockReturnValue(of([buildBloco()]));
    const fixture = await createFixture(mocks);

    expect(el(fixture).querySelector('.dash__bloco-disciplina')?.textContent?.trim()).toBe(
      'Disciplina',
    );
  });
});

describe('DashboardPage — sessão ativa', () => {
  it('sessão RUNNING → banner "em andamento" com CTA "Continuar" para /sessoes', async () => {
    const mocks = buildMocks();
    mocks.sessao.getAtiva.mockReturnValue(of(buildSessao()));
    const fixture = await createFixture(mocks);

    const banner = el(fixture).querySelector('.dash__sessao')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('sessão de estudo em andamento');
    const cta = banner.querySelector('a')!;
    expect(cta.textContent?.trim()).toBe('Continuar');
    expect(cta.getAttribute('href')).toBe('/sessoes');
  });

  it('sessão PAUSED → banner indica "pausada"', async () => {
    const mocks = buildMocks();
    mocks.sessao.getAtiva.mockReturnValue(of(buildSessao({ estado: 'PAUSED' })));
    const fixture = await createFixture(mocks);

    expect(el(fixture).querySelector('.dash__sessao')?.textContent).toContain(
      'sessão de estudo pausada',
    );
  });
});

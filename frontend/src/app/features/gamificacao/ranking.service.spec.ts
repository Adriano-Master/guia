import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { Paginated } from '../../core/auth/auth.models';
import type { MinhaPontuacao, RankingEntry } from './gamificacao.models';
import { RankingService } from './ranking.service';

/**
 * Contratos HTTP do RankingService: URLs sob /api/v1/ranking, paginação por
 * page/pageSize (omitidos quando ausentes) e envelope paginado padrão.
 */

function setup(): { service: RankingService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(RankingService),
    http: TestBed.inject(HttpTestingController),
  };
}

function buildPage(): Paginated<RankingEntry> {
  return {
    data: [
      {
        posicao: 1,
        alunoId: 'a1',
        nome: 'Ana',
        pontos: 700,
        subtemasConcluidos: 30,
        horasEstudadas: 40,
      },
    ],
    page: 1,
    pageSize: 20,
    total: 137,
  };
}

describe('RankingService', () => {
  it('global faz GET /ranking/global com page/pageSize e os omite quando ausentes', () => {
    const { service, http } = setup();
    const resultados: Paginated<RankingEntry>[] = [];

    service.global({ page: 2, pageSize: 20 }).subscribe((r) => resultados.push(r));
    const req = http.expectOne((r) => r.url === '/api/v1/ranking/global');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush(buildPage());
    expect(resultados[0].total).toBe(137);
    expect(resultados[0].data[0].pontos).toBe(700);

    service.global().subscribe();
    const semParams = http.expectOne((r) => r.url === '/api/v1/ranking/global');
    expect(semParams.request.params.keys()).toEqual([]);
    semParams.flush(buildPage());
    http.verify();
  });

  it('porTurma faz GET /ranking/turmas/{id} com paginação', () => {
    const { service, http } = setup();

    service.porTurma('t1', { page: 1, pageSize: 20 }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/ranking/turmas/t1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush(buildPage());
    http.verify();
  });

  it('me faz GET /ranking/me sem params e entrega a composição', () => {
    const { service, http } = setup();
    const resultados: MinhaPontuacao[] = [];

    service.me().subscribe((r) => resultados.push(r));

    const req = http.expectOne('/api/v1/ranking/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({
      posicaoGlobal: 12,
      pontos: 700,
      subtemasConcluidos: 30,
      horasEstudadas: 40,
      semanasConsistentes: 4,
      composicao: { pontosSubtemas: 300, pontosHoras: 200, pontosBonus: 200 },
      turmas: [{ turmaId: 't1', nome: 'Turma A', posicao: 3 }],
    });

    expect(resultados[0].posicaoGlobal).toBe(12);
    expect(resultados[0].composicao.pontosBonus).toBe(200);
    expect(resultados[0].turmas[0].posicao).toBe(3);
    http.verify();
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { ResumoEstatisticas, SerieTemporal } from './estatisticas.models';
import { EstatisticasService } from './estatisticas.service';

/**
 * Contratos HTTP do EstatisticasService: URLs sob /api/v1/estatisticas e
 * query params (from/to como dias YYYY-MM-DD crus, granularidade,
 * porDisciplina, agruparPor), omitindo os ausentes.
 */

function setup(): { service: EstatisticasService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(EstatisticasService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('EstatisticasService', () => {
  it('resumo faz GET /estatisticas/resumo sem params', () => {
    const { service, http } = setup();
    const resultados: ResumoEstatisticas[] = [];

    service.resumo().subscribe((r) => resultados.push(r));

    const req = http.expectOne('/api/v1/estatisticas/resumo');
    expect(req.request.method).toBe('GET');
    req.flush({
      horasTotais: 12.5,
      progresso: { percentual: 25, concluidos: 3, totalSubtemas: 12 },
      questoes: { total: 40, erros: 10, taxaErro: 0.25 },
    });

    expect(resultados[0].horasTotais).toBe(12.5);
    expect(resultados[0].questoes.taxaErro).toBe(0.25);
    http.verify();
  });

  it('horasPorDisciplina envia from/to crus e os omite quando ausentes', () => {
    const { service, http } = setup();

    service.horasPorDisciplina({ from: '2026-07-01', to: '2026-07-07' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/estatisticas/horas-por-disciplina');
    expect(req.request.params.get('from')).toBe('2026-07-01');
    expect(req.request.params.get('to')).toBe('2026-07-07');
    req.flush({ data: [], totalHoras: 0 });

    service.horasPorDisciplina().subscribe();
    const semFiltros = http.expectOne((r) => r.url === '/api/v1/estatisticas/horas-por-disciplina');
    expect(semFiltros.request.params.keys()).toEqual([]);
    semFiltros.flush({ data: [], totalHoras: 0 });
    http.verify();
  });

  it('serieTemporal envia granularidade/from/to e nada quando omitidos', () => {
    const { service, http } = setup();
    const resultados: SerieTemporal[] = [];

    service
      .serieTemporal({ granularidade: 'semana', from: '2026-06-01', to: '2026-06-30' })
      .subscribe((r) => resultados.push(r));
    const req = http.expectOne((r) => r.url === '/api/v1/estatisticas/serie-temporal');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('granularidade')).toBe('semana');
    expect(req.request.params.get('from')).toBe('2026-06-01');
    expect(req.request.params.get('to')).toBe('2026-06-30');
    req.flush({
      granularidade: 'semana',
      from: '2026-06-01',
      to: '2026-06-30',
      timezone: 'America/Sao_Paulo',
      data: [{ bucket: '2026-06-01', horas: 2 }],
    });
    expect(resultados[0].data).toHaveLength(1);

    service.serieTemporal().subscribe();
    const semFiltros = http.expectOne((r) => r.url === '/api/v1/estatisticas/serie-temporal');
    expect(semFiltros.request.params.keys()).toEqual([]);
    semFiltros.flush({
      granularidade: 'dia',
      from: '2026-06-23',
      to: '2026-07-23',
      timezone: 'America/Sao_Paulo',
      data: [],
    });
    http.verify();
  });

  it('progresso só envia porDisciplina=true quando pedido', () => {
    const { service, http } = setup();

    service.progresso(true).subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/estatisticas/progresso');
    expect(req.request.params.get('porDisciplina')).toBe('true');
    req.flush({ percentual: 50, concluidos: 6, totalSubtemas: 12, porDisciplina: [] });

    service.progresso().subscribe();
    const semDetalhe = http.expectOne((r) => r.url === '/api/v1/estatisticas/progresso');
    expect(semDetalhe.request.params.keys()).toEqual([]);
    semDetalhe.flush({ percentual: 50, concluidos: 6, totalSubtemas: 12 });
    http.verify();
  });

  it('desempenhoQuestoes envia agruparPor e o omite quando ausente', () => {
    const { service, http } = setup();

    service.desempenhoQuestoes('tema').subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/estatisticas/desempenho-questoes');
    expect(req.request.params.get('agruparPor')).toBe('tema');
    req.flush({ total: 10, erros: 2, taxaErro: 0.2, data: [] });

    service.desempenhoQuestoes().subscribe();
    const semGrupo = http.expectOne((r) => r.url === '/api/v1/estatisticas/desempenho-questoes');
    expect(semGrupo.request.params.keys()).toEqual([]);
    semGrupo.flush({ total: 10, erros: 2, taxaErro: 0.2 });
    http.verify();
  });
});

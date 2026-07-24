import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { Desempenho, RegistroQuestoes } from './questoes.models';
import { QuestoesService } from './questoes.service';

/**
 * Contratos HTTP do QuestoesService: URLs/payloads, desembrulho de
 * { registro } e query params com from/to como dias de calendário
 * YYYY-MM-DD crus (ambos inclusivos — contrato de /questoes).
 */

function buildRegistro(overrides: Partial<RegistroQuestoes> = {}): RegistroQuestoes {
  return {
    id: 'reg-1',
    alunoId: 'user-1',
    temaId: 'tema-1',
    subtemaId: null,
    data: '2026-07-01',
    total: 20,
    erros: 8,
    taxaErro: 0.4,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

function setup(): { service: QuestoesService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { service: TestBed.inject(QuestoesService), http: TestBed.inject(HttpTestingController) };
}

describe('QuestoesService', () => {
  it('create faz POST /questoes com o payload e desembrulha { registro }', () => {
    const { service, http } = setup();
    const registros: RegistroQuestoes[] = [];

    service
      .create({ temaId: 'tema-1', subtemaId: 'sub-1', data: '2026-07-01', total: 20, erros: 8 })
      .subscribe((r) => registros.push(r));

    const req = http.expectOne('/api/v1/questoes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      temaId: 'tema-1',
      subtemaId: 'sub-1',
      data: '2026-07-01',
      total: 20,
      erros: 8,
    });
    req.flush({ registro: buildRegistro({ subtemaId: 'sub-1' }) });

    expect(registros[0].taxaErro).toBe(0.4);
    http.verify();
  });

  it('list envia from/to como YYYY-MM-DD crus (ambos presentes)', () => {
    const { service, http } = setup();

    service
      .list({ page: 2, pageSize: 10, sort: '-data', temaId: 'tema-1', from: '2026-07-01', to: '2026-07-07' })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/questoes' && r.method === 'GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('sort')).toBe('-data');
    expect(req.request.params.get('temaId')).toBe('tema-1');
    expect(req.request.params.get('from')).toBe('2026-07-01');
    expect(req.request.params.get('to')).toBe('2026-07-07');
    req.flush({ data: [], page: 2, pageSize: 10, total: 0 });
    http.verify();
  });

  it('list omite from/to/temaId ausentes', () => {
    const { service, http } = setup();

    service.list({ page: 1, pageSize: 10 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/questoes');
    expect(req.request.params.keys().sort()).toEqual(['page', 'pageSize']);
    req.flush({ data: [], page: 1, pageSize: 10, total: 0 });
    http.verify();
  });

  it('get desembrulha { registro }', () => {
    const { service, http } = setup();
    const registros: RegistroQuestoes[] = [];

    service.get('reg-1').subscribe((r) => registros.push(r));

    const req = http.expectOne('/api/v1/questoes/reg-1');
    expect(req.request.method).toBe('GET');
    req.flush({ registro: buildRegistro() });

    expect(registros[0].id).toBe('reg-1');
    http.verify();
  });

  it('update faz PATCH parcial preservando subtemaId: null explícito no corpo', () => {
    const { service, http } = setup();

    service.update('reg-1', { erros: 5, subtemaId: null }).subscribe();

    const req = http.expectOne('/api/v1/questoes/reg-1');
    expect(req.request.method).toBe('PATCH');
    // null explícito desvincula; o corpo NÃO pode descartá-lo
    expect(req.request.body).toEqual({ erros: 5, subtemaId: null });
    req.flush({ registro: buildRegistro({ erros: 5, taxaErro: 0.25 }) });
    http.verify();
  });

  it('remove faz DELETE /questoes/:id', () => {
    const { service, http } = setup();

    service.remove('reg-1').subscribe();

    const req = http.expectOne('/api/v1/questoes/reg-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    http.verify();
  });

  it('desempenho envia filtros e sem params quando omitidos', () => {
    const { service, http } = setup();
    const resultados: Desempenho[] = [];

    service
      .desempenho({ temaId: 'tema-1', from: '2026-06-01', to: '2026-06-30' })
      .subscribe((d) => resultados.push(d));

    const req = http.expectOne((r) => r.url === '/api/v1/questoes/desempenho');
    expect(req.request.params.get('temaId')).toBe('tema-1');
    expect(req.request.params.get('from')).toBe('2026-06-01');
    expect(req.request.params.get('to')).toBe('2026-06-30');
    req.flush({ data: [], from: '2026-06-01', to: '2026-06-30' });
    expect(resultados[0].from).toBe('2026-06-01');

    service.desempenho().subscribe();
    const semFiltros = http.expectOne((r) => r.url === '/api/v1/questoes/desempenho');
    expect(semFiltros.request.params.keys()).toEqual([]);
    semFiltros.flush({ data: [], from: '2026-06-07', to: '2026-07-07' });
    http.verify();
  });
});

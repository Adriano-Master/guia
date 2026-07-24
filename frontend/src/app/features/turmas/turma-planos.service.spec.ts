import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TurmaPlanosService } from './turma-planos.service';
import type { TurmaPlano } from './turmas.models';

/** Contratos HTTP do TurmaPlanosService: URLs, payloads e unwrap de { turmaPlano }. */

function buildVinculo(overrides: Partial<TurmaPlano> = {}): TurmaPlano {
  return {
    id: 'tp-1',
    turmaId: 'turma-1',
    planoId: 'plano-1',
    createdAt: '2026-07-07T12:00:00.000Z',
    plano: { id: 'plano-1', titulo: 'Plano Oficial TRT', tipo: 'OFICIAL', publicado: true },
    ...overrides,
  };
}

function setup(): { service: TurmaPlanosService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(TurmaPlanosService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('TurmaPlanosService', () => {
  it('vincular faz POST /turmas/:id/planos com { planoId } e desembrulha { turmaPlano }', () => {
    const { service, http } = setup();
    const vinculos: TurmaPlano[] = [];

    service.vincular('turma-1', 'plano-1').subscribe((v) => vinculos.push(v));

    const req = http.expectOne('/api/v1/turmas/turma-1/planos');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ planoId: 'plano-1' });
    req.flush({ turmaPlano: buildVinculo() });

    expect(vinculos[0].plano?.titulo).toBe('Plano Oficial TRT');
    http.verify();
  });

  it('list faz GET /turmas/:id/planos com params de paginação', () => {
    const { service, http } = setup();

    service.list('turma-1', { page: 1, pageSize: 100 }).subscribe();

    const req = http.expectOne(
      (r) => r.url === '/api/v1/turmas/turma-1/planos' && r.method === 'GET',
    );
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('100');
    req.flush({ data: [buildVinculo()], page: 1, pageSize: 100, total: 1 });
    http.verify();
  });

  it('desvincular faz DELETE /turmas/:id/planos/:planoId', () => {
    const { service, http } = setup();

    service.desvincular('turma-1', 'plano-1').subscribe();

    const req = http.expectOne('/api/v1/turmas/turma-1/planos/plano-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    http.verify();
  });
});

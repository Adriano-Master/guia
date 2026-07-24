import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { MatriculasService } from './matriculas.service';
import type { Matricula } from './turmas.models';

/** Contratos HTTP do MatriculasService: URLs, payloads e unwrap de { matricula }. */

const NOW = '2026-07-07T12:00:00.000Z';

function buildMatricula(overrides: Partial<Matricula> = {}): Matricula {
  return {
    id: 'mat-1',
    turmaId: 'turma-1',
    alunoId: 'user-1',
    status: 'ATIVA',
    createdAt: NOW,
    updatedAt: NOW,
    turma: { id: 'turma-1', nome: 'Turma TRT 2026', descricao: null, ativa: true },
    ...overrides,
  };
}

function setup(): { service: MatriculasService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(MatriculasService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('MatriculasService', () => {
  it('matricular faz POST /matriculas com { codigoConvite } e desembrulha { matricula }', () => {
    const { service, http } = setup();
    const matriculas: Matricula[] = [];

    service.matricular('ABCD2345').subscribe((m) => matriculas.push(m));

    const req = http.expectOne('/api/v1/matriculas');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ codigoConvite: 'ABCD2345' });
    req.flush({ matricula: buildMatricula() });

    expect(matriculas[0].turma?.nome).toBe('Turma TRT 2026');
    http.verify();
  });

  it('listMe faz GET /matriculas/me com params (status=ATIVA incluído)', () => {
    const { service, http } = setup();

    service.listMe({ page: 1, pageSize: 10, sort: '-createdAt', status: 'ATIVA' }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/matriculas/me' && r.method === 'GET');
    expect(req.request.params.get('status')).toBe('ATIVA');
    expect(req.request.params.get('sort')).toBe('-createdAt');
    req.flush({ data: [], page: 1, pageSize: 10, total: 0 });
    http.verify();
  });

  it('listByTurma faz GET /turmas/:id/matriculas e omite status ausente', () => {
    const { service, http } = setup();

    service.listByTurma('turma-1', { page: 2 }).subscribe();

    const req = http.expectOne(
      (r) => r.url === '/api/v1/turmas/turma-1/matriculas' && r.method === 'GET',
    );
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.has('status')).toBe(false);
    req.flush({ data: [], page: 2, pageSize: 10, total: 0 });
    http.verify();
  });

  it('updateStatus faz PATCH /matriculas/:id com { status } e desembrulha { matricula }', () => {
    const { service, http } = setup();
    const matriculas: Matricula[] = [];

    service.updateStatus('mat-1', 'INATIVA').subscribe((m) => matriculas.push(m));

    const req = http.expectOne('/api/v1/matriculas/mat-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'INATIVA' });
    req.flush({ matricula: buildMatricula({ status: 'INATIVA' }) });

    expect(matriculas[0].status).toBe('INATIVA');
    http.verify();
  });
});

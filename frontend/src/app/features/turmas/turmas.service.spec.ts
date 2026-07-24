import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { Turma } from './turmas.models';
import { TurmasService } from './turmas.service';

/** Contratos HTTP do TurmasService: URLs, payloads e unwrap de { turma }. */

const NOW = '2026-07-07T12:00:00.000Z';

function buildTurma(overrides: Partial<Turma> = {}): Turma {
  return {
    id: 'turma-1',
    nome: 'Turma TRT 2026',
    descricao: null,
    professorId: 'prof-1',
    ativa: true,
    createdAt: NOW,
    updatedAt: NOW,
    codigoConvite: 'ABCD2345',
    ...overrides,
  };
}

function setup(): { service: TurmasService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { service: TestBed.inject(TurmasService), http: TestBed.inject(HttpTestingController) };
}

describe('TurmasService', () => {
  it('list envia os params e ativa=false NÃO é descartado como vazio', () => {
    const { service, http } = setup();

    service.list({ page: 2, pageSize: 12, sort: '-createdAt', ativa: false }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/turmas' && r.method === 'GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('12');
    expect(req.request.params.get('sort')).toBe('-createdAt');
    expect(req.request.params.get('ativa')).toBe('false');
    req.flush({ data: [], page: 2, pageSize: 12, total: 0 });
    http.verify();
  });

  it('list omite ativa quando não filtrado', () => {
    const { service, http } = setup();

    service.list({ page: 1 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/turmas');
    expect(req.request.params.has('ativa')).toBe(false);
    req.flush({ data: [], page: 1, pageSize: 12, total: 0 });
    http.verify();
  });

  it('get desembrulha { turma }', () => {
    const { service, http } = setup();
    const turmas: Turma[] = [];

    service.get('turma-1').subscribe((t) => turmas.push(t));

    const req = http.expectOne('/api/v1/turmas/turma-1');
    expect(req.request.method).toBe('GET');
    req.flush({ turma: buildTurma() });

    expect(turmas[0].nome).toBe('Turma TRT 2026');
    http.verify();
  });

  it('create faz POST com o payload e desembrulha { turma }', () => {
    const { service, http } = setup();
    const turmas: Turma[] = [];

    service.create({ nome: 'Nova turma', descricao: 'Foco em TRT' }).subscribe((t) =>
      turmas.push(t),
    );

    const req = http.expectOne('/api/v1/turmas');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ nome: 'Nova turma', descricao: 'Foco em TRT' });
    req.flush({ turma: buildTurma({ nome: 'Nova turma' }) });

    expect(turmas[0].nome).toBe('Nova turma');
    http.verify();
  });

  it('update faz PATCH parcial (ex.: ativa=false) e desembrulha { turma }', () => {
    const { service, http } = setup();
    const turmas: Turma[] = [];

    service.update('turma-1', { ativa: false }).subscribe((t) => turmas.push(t));

    const req = http.expectOne('/api/v1/turmas/turma-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ ativa: false });
    req.flush({ turma: buildTurma({ ativa: false }) });

    expect(turmas[0].ativa).toBe(false);
    http.verify();
  });

  it('regenerarCodigo faz POST sem corpo útil e desembrulha { codigoConvite }', () => {
    const { service, http } = setup();
    const codigos: string[] = [];

    service.regenerarCodigo('turma-1').subscribe((c) => codigos.push(c));

    const req = http.expectOne('/api/v1/turmas/turma-1/regenerar-codigo');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ codigoConvite: 'ZZZZ9999' });

    expect(codigos).toEqual(['ZZZZ9999']);
    http.verify();
  });

  it('delete faz DELETE /turmas/:id', () => {
    const { service, http } = setup();

    service.delete('turma-1').subscribe();

    const req = http.expectOne('/api/v1/turmas/turma-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    http.verify();
  });
});

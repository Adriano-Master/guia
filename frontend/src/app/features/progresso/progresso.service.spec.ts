import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { ProgressoMarcacao, ProgressoPlano, ProgressoSubtemaFlat } from './progresso.models';
import { ProgressoService } from './progresso.service';

/**
 * Contratos HTTP do ProgressoService (espelham a API de progresso):
 * PUT upsert idempotente da marcação, GET da árvore do plano e listagem
 * flat de subtemas com montagem de query params (omitindo vazios).
 */

function setup(): { service: ProgressoService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(ProgressoService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('ProgressoService', () => {
  it('setConcluido faz PUT /progresso/subtemas/:id com body { concluido }', () => {
    const { service, http } = setup();
    const respostas: ProgressoMarcacao[] = [];

    service.setConcluido('sub-1', true).subscribe((res) => respostas.push(res));

    const req = http.expectOne('/api/v1/progresso/subtemas/sub-1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ concluido: true });
    req.flush({ subtemaId: 'sub-1', concluido: true, concluidoEm: '2026-07-07T12:00:00.000Z' });

    expect(respostas).toHaveLength(1);
    expect(respostas[0].concluido).toBe(true);
    http.verify();
  });

  it('setConcluido(false) envia { concluido: false } (desmarcação idempotente)', () => {
    const { service, http } = setup();

    service.setConcluido('sub-1', false).subscribe();

    const req = http.expectOne('/api/v1/progresso/subtemas/sub-1');
    expect(req.request.body).toEqual({ concluido: false });
    req.flush({ subtemaId: 'sub-1', concluido: false, concluidoEm: null });
    http.verify();
  });

  it('getPlano faz GET /progresso/planos/:id e devolve a árvore', () => {
    const { service, http } = setup();
    const arvores: ProgressoPlano[] = [];

    service.getPlano('plano-1').subscribe((res) => arvores.push(res));

    const req = http.expectOne('/api/v1/progresso/planos/plano-1');
    expect(req.request.method).toBe('GET');
    req.flush({
      planoId: 'plano-1',
      progressoPercentual: 25,
      subtemasConcluidos: 1,
      subtemasTotais: 4,
      disciplinas: [],
    });

    expect(arvores[0].planoId).toBe('plano-1');
    http.verify();
  });

  it('listSubtemas monta os query params e desembrulha res.subtemas', () => {
    const { service, http } = setup();
    const listas: ProgressoSubtemaFlat[][] = [];

    service
      .listSubtemas({ planoId: 'plano-1', temaId: 'tema-1', concluido: false })
      .subscribe((res) => listas.push(res));

    const req = http.expectOne(
      (r) => r.url === '/api/v1/progresso/subtemas' && r.method === 'GET',
    );
    expect(req.request.params.get('planoId')).toBe('plano-1');
    expect(req.request.params.get('temaId')).toBe('tema-1');
    // booleano false NÃO pode ser descartado como "vazio"
    expect(req.request.params.get('concluido')).toBe('false');
    req.flush({
      subtemas: [
        {
          subtemaId: 'sub-1',
          nome: 'Concordância',
          ordem: 1,
          temaId: 'tema-1',
          disciplinaId: 'disc-1',
          concluido: false,
          concluidoEm: null,
        },
      ],
    });

    expect(listas[0]).toHaveLength(1);
    expect(listas[0][0].subtemaId).toBe('sub-1');
    http.verify();
  });

  it('listSubtemas omite params opcionais ausentes', () => {
    const { service, http } = setup();

    service.listSubtemas({ planoId: 'plano-1' }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/progresso/subtemas');
    expect(req.request.params.keys()).toEqual(['planoId']);
    req.flush({ subtemas: [] });
    http.verify();
  });
});

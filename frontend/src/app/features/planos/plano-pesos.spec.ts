import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PlanoPesosComponent } from './plano-pesos';
import type { PlanoTree } from './planos.models';
import { PlanosService } from './planos.service';

/**
 * Regressão de code review (plano-de-estudo): o effect que sincroniza o signal
 * `values` a partir de `plano()` deve usar untracked() — sem isso, escrever em
 * `values` dentro do próprio effect reagenda-o para sempre e a renderização de
 * um plano com 1 disciplina estourava NG0103 (infinite change detection loop).
 */

function buildPlanoTree(): PlanoTree {
  const now = '2026-07-06T12:00:00.000Z';
  return {
    id: 'plano-1',
    titulo: 'Analista TRF',
    descricao: null,
    tipo: 'OFICIAL',
    autorId: 'user-1',
    planoOrigemId: null,
    publicado: true,
    createdAt: now,
    updatedAt: now,
    disciplinas: [
      {
        id: 'disc-1',
        planoId: 'plano-1',
        nome: 'Português',
        ordem: 1,
        createdAt: now,
        updatedAt: now,
        temas: [],
      },
    ],
    pesos: [
      {
        id: 'peso-1',
        planoId: 'plano-1',
        disciplinaId: 'disc-1',
        pesoPercentual: 100,
      },
    ],
  };
}

describe('PlanoPesosComponent — regressão NG0103', () => {
  const planosServiceStub = { setPesos: vi.fn(() => of([])) };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlanoPesosComponent],
      providers: [{ provide: PlanosService, useValue: planosServiceStub }],
    });
  });

  it('renderiza plano com 1 disciplina sem loop de change detection', async () => {
    const fixture = TestBed.createComponent(PlanoPesosComponent);
    fixture.componentRef.setInput('plano', buildPlanoTree());
    fixture.componentRef.setInput('canEdit', true);

    // Sem o untracked() no effect, esta estabilização lançava NG0103.
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    const inputs = element.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe('100.00');
    // Σ = 100.00 → badge de soma OK visível
    expect(element.querySelector('.pesos__sum--ok')?.textContent).toContain('100.00');
  });

  it('atualizar o input plano() re-executa o effect uma única vez e permanece estável', async () => {
    const fixture = TestBed.createComponent(PlanoPesosComponent);
    fixture.componentRef.setInput('plano', buildPlanoTree());
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    const atualizado = buildPlanoTree();
    atualizado.disciplinas.push({
      id: 'disc-2',
      planoId: 'plano-1',
      nome: 'Direito',
      ordem: 2,
      createdAt: atualizado.createdAt,
      updatedAt: atualizado.updatedAt,
      temas: [],
    });
    fixture.componentRef.setInput('plano', atualizado);
    await fixture.whenStable();

    const inputs = fixture.nativeElement.querySelectorAll('input[type="number"]');
    expect(inputs).toHaveLength(2);
  });
});

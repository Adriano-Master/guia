import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import type { DisciplinaTree, Plano, PlanoTree } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { HistoricoQuestoes } from './historico-questoes';
import QuestoesPage from './questoes-page';
import type { RegistroQuestoes } from './questoes.models';
import { QuestoesService } from './questoes.service';
import { RegistroQuestoesForm } from './registro-questoes-form';

/**
 * Página "Questões": auto-seleção de plano único, troca de plano alimentando
 * o form (com cache de árvores para o histórico), e o roteamento de refresh —
 * criar atualiza histórico E painel; editar/excluir atualiza SÓ o painel.
 */

const NOW = '2026-07-01T12:00:00.000Z';

function buildPlano(id: string, titulo: string): Plano {
  return {
    id,
    titulo,
    descricao: null,
    tipo: 'PESSOAL',
    autorId: 'user-1',
    planoOrigemId: null,
    publicado: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDisciplina(id: string, planoId: string, nome: string, temaNome: string): DisciplinaTree {
  return {
    id,
    planoId,
    nome,
    ordem: 1,
    createdAt: NOW,
    updatedAt: NOW,
    temas: [
      {
        id: `tema-${id}`,
        disciplinaId: id,
        nome: temaNome,
        ordem: 1,
        createdAt: NOW,
        updatedAt: NOW,
        subtemas: [],
      },
    ],
  };
}

function buildTree(id: string, titulo: string, disciplinas: DisciplinaTree[]): PlanoTree {
  return { ...buildPlano(id, titulo), disciplinas, pesos: [] };
}

function buildRegistro(): RegistroQuestoes {
  return {
    id: 'reg-1',
    alunoId: 'user-1',
    temaId: 'tema-disc-1',
    subtemaId: null,
    data: '2026-07-01',
    total: 10,
    erros: 2,
    taxaErro: 0.2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface Mocks {
  planos: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  questoes: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    desempenho: ReturnType<typeof vi.fn>;
  };
}

function buildMocks(planos: Plano[]): Mocks {
  const trees = new Map<string, PlanoTree>([
    ['plano-1', buildTree('plano-1', 'Plano A', [buildDisciplina('disc-1', 'plano-1', 'Português', 'Sintaxe')])],
    ['plano-2', buildTree('plano-2', 'Plano B', [buildDisciplina('disc-2', 'plano-2', 'Direito', 'Constitucional')])],
  ]);
  return {
    planos: {
      list: vi.fn(() => of({ data: planos, page: 1, pageSize: 100, total: planos.length })),
      get: vi.fn((id: string) => of(trees.get(id)!)),
    },
    questoes: {
      create: vi.fn(() => of(buildRegistro())),
      list: vi.fn(() => of({ data: [], page: 1, pageSize: 10, total: 0 })),
      update: vi.fn(() => of(buildRegistro())),
      remove: vi.fn(() => of(void 0)),
      desempenho: vi.fn(() => of({ data: [], from: '2026-06-07', to: '2026-07-07' })),
    },
  };
}

async function createFixture(mocks: Mocks): Promise<ComponentFixture<QuestoesPage>> {
  TestBed.configureTestingModule({
    imports: [QuestoesPage],
    providers: [
      { provide: PlanosService, useValue: mocks.planos },
      { provide: QuestoesService, useValue: mocks.questoes },
    ],
  });
  const fixture = TestBed.createComponent(QuestoesPage);
  await fixture.whenStable();
  return fixture;
}

function el(fixture: ComponentFixture<QuestoesPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function optgroupsDoForm(fixture: ComponentFixture<QuestoesPage>): string[] {
  return Array.from(
    el(fixture).querySelectorAll<HTMLOptGroupElement>('#qform-tema optgroup'),
  ).map((g) => g.label);
}

async function selecionarPlano(
  fixture: ComponentFixture<QuestoesPage>,
  id: string,
): Promise<void> {
  const select = el(fixture).querySelector<HTMLSelectElement>('#questoes-plano')!;
  select.value = id;
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuestoesPage — seleção de plano', () => {
  it('plano único auto-seleciona e alimenta os temas do formulário', async () => {
    const mocks = buildMocks([buildPlano('plano-1', 'Plano A')]);
    const fixture = await createFixture(mocks);

    expect(mocks.planos.get).toHaveBeenCalledExactlyOnceWith('plano-1');
    expect(fixture.componentInstance.planoId()).toBe('plano-1');
    expect(optgroupsDoForm(fixture)).toEqual(['Português']);
  });

  it('vários planos → não auto-seleciona; trocar de plano recarrega os temas com cache', async () => {
    const mocks = buildMocks([buildPlano('plano-1', 'Plano A'), buildPlano('plano-2', 'Plano B')]);
    const fixture = await createFixture(mocks);

    expect(mocks.planos.get).not.toHaveBeenCalled();
    expect(optgroupsDoForm(fixture)).toEqual([]);

    await selecionarPlano(fixture, 'plano-1');
    expect(optgroupsDoForm(fixture)).toEqual(['Português']);

    await selecionarPlano(fixture, 'plano-2');
    expect(optgroupsDoForm(fixture)).toEqual(['Direito']);
    expect(mocks.planos.get).toHaveBeenCalledTimes(2);

    // voltar ao plano-1 usa o cache (sem novo GET) e o histórico conhece as duas árvores
    await selecionarPlano(fixture, 'plano-1');
    expect(mocks.planos.get).toHaveBeenCalledTimes(2);
    expect(optgroupsDoForm(fixture)).toEqual(['Português']);
    expect(fixture.componentInstance.todasDisciplinas().map((d) => d.nome).sort()).toEqual([
      'Direito',
      'Português',
    ]);
  });
});

describe('QuestoesPage — roteamento de refresh', () => {
  it('criar registro → recarrega histórico E painel de desempenho', async () => {
    const mocks = buildMocks([buildPlano('plano-1', 'Plano A')]);
    const fixture = await createFixture(mocks);
    // boot: 1 list (histórico) + 1 desempenho
    expect(mocks.questoes.list).toHaveBeenCalledTimes(1);
    expect(mocks.questoes.desempenho).toHaveBeenCalledTimes(1);

    const form = fixture.debugElement.query(By.directive(RegistroQuestoesForm))
      .componentInstance as RegistroQuestoesForm;
    form.criado.emit(buildRegistro());
    await fixture.whenStable();

    expect(mocks.questoes.list).toHaveBeenCalledTimes(2);
    expect(mocks.questoes.desempenho).toHaveBeenCalledTimes(2);
  });

  it('editar/excluir (alterado) → recarrega SÓ o painel de desempenho', async () => {
    const mocks = buildMocks([buildPlano('plano-1', 'Plano A')]);
    const fixture = await createFixture(mocks);

    const historico = fixture.debugElement.query(By.directive(HistoricoQuestoes))
      .componentInstance as HistoricoQuestoes;
    historico.alterado.emit();
    await fixture.whenStable();

    // histórico se atualiza sozinho (não recarrega via tick); painel sim
    expect(mocks.questoes.list).toHaveBeenCalledTimes(1);
    expect(mocks.questoes.desempenho).toHaveBeenCalledTimes(2);
  });
});

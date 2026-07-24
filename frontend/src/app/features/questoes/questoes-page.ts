import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import { CronogramaService, planoPadraoEntre } from '../cronograma/cronograma.service';
import type { DisciplinaTree, Plano, PlanoTree } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { DesempenhoQuestoes } from './desempenho-questoes';
import { HistoricoQuestoes } from './historico-questoes';
import { RegistroQuestoesForm } from './registro-questoes-form';

/**
 * Página "Questões": registro + painel de desempenho + histórico. O seletor de
 * plano alimenta os seletores de tema/subtema do formulário (mesmo padrão de
 * sessões). As árvores carregadas ficam em cache para o histórico resolver
 * nomes de registros de outros planos já visitados.
 */
@Component({
  selector: 'app-questoes-page',
  imports: [FormsModule, RegistroQuestoesForm, DesempenhoQuestoes, HistoricoQuestoes],
  template: `
    <section class="questoes">
      <h1>Questões</h1>

      @if (planoError()) {
        <p class="alert alert--error" role="alert">{{ planoError() }}</p>
      }

      <div class="field questoes__plano">
        <label for="questoes-plano">Plano de estudo</label>
        <select id="questoes-plano" [ngModel]="planoId()" (ngModelChange)="setPlano($event)">
          <option value="" disabled>
            {{ loadingPlanos() ? 'Carregando planos…' : 'Selecione um plano' }}
          </option>
          @for (plano of planos(); track plano.id) {
            <option [value]="plano.id">{{ plano.titulo }} ({{ plano.tipo }})</option>
          }
        </select>
        <span class="field__hint">Os temas e subtemas abaixo vêm do plano escolhido.</span>
      </div>

      <div class="questoes__top">
        <app-registro-questoes-form
          [disciplinas]="disciplinas()"
          (criado)="onRegistroCriado()"
        />
        <app-desempenho-questoes [refresh]="desempenhoTick()" />
      </div>

      <app-historico-questoes
        [disciplinas]="todasDisciplinas()"
        [refresh]="historicoTick()"
        (alterado)="onRegistroAlterado()"
      />
    </section>
  `,
  styles: `
    .questoes {
      display: grid;
      gap: 1rem;
      max-width: 64rem;
      margin: 0 auto;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .questoes__plano {
      max-width: 28rem;
      margin-bottom: 0;
    }
    .questoes__top {
      display: grid;
      gap: 1rem;
      grid-template-columns: 1fr;
      align-items: start;

      @media (min-width: 768px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
})
export default class QuestoesPage {
  private readonly planosService = inject(PlanosService);
  private readonly cronogramaService = inject(CronogramaService);

  readonly loadingPlanos = signal(true);
  readonly planoError = signal<string | null>(null);

  readonly planos = signal<Plano[]>([]);
  readonly planoId = signal('');
  /** Cache das árvores carregadas (nomes para o histórico). */
  private readonly trees = signal<Map<string, PlanoTree>>(new Map());

  readonly historicoTick = signal(0);
  readonly desempenhoTick = signal(0);

  readonly disciplinas = computed<DisciplinaTree[]>(
    () => this.trees().get(this.planoId())?.disciplinas ?? [],
  );

  readonly todasDisciplinas = computed<DisciplinaTree[]>(() =>
    [...this.trees().values()].flatMap((tree) => tree.disciplinas),
  );

  constructor() {
    // Auto-seleção: plano do cronograma ativo se acessível → senão plano
    // único. planoPadraoId() nunca erra (404 → null), seguro no forkJoin.
    forkJoin([
      this.planosService.list({ page: 1, pageSize: 100, sort: 'titulo' }),
      this.cronogramaService.planoPadraoId(),
    ]).subscribe({
      next: ([res, padraoId]) => {
        this.planos.set(res.data);
        this.loadingPlanos.set(false);
        if (!this.planoId()) {
          const padrao = planoPadraoEntre(res.data, padraoId);
          if (padrao) this.setPlano(padrao);
        }
      },
      error: (err: unknown) => {
        this.loadingPlanos.set(false);
        this.planoError.set(extractApiError(err).message);
      },
    });
  }

  setPlano(id: string): void {
    this.planoId.set(id);
    this.planoError.set(null);
    if (!id || this.trees().has(id)) return;
    this.planosService.get(id).subscribe({
      next: (tree) => {
        this.trees.set(new Map(this.trees()).set(tree.id, tree));
      },
      error: (err: unknown) => this.planoError.set(extractApiError(err).message),
    });
  }

  onRegistroCriado(): void {
    this.historicoTick.set(this.historicoTick() + 1);
    this.desempenhoTick.set(this.desempenhoTick() + 1);
  }

  /** Edição/exclusão: o histórico já se atualiza sozinho; só o painel recarrega. */
  onRegistroAlterado(): void {
    this.desempenhoTick.set(this.desempenhoTick() + 1);
  }
}

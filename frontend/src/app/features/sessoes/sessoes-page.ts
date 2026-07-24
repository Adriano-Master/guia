import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import { CronogramaService, planoPadraoEntre } from '../cronograma/cronograma.service';
import type { DisciplinaTree, Plano, PlanoTree } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { Cronometro } from './cronometro';
import { HistoricoSessoes } from './historico-sessoes';
import { RegistroManual } from './registro-manual';
import type { CronometroPrefill } from './sessoes.models';

/**
 * Página "Estudar": cronômetro + registro manual + histórico. O seletor de
 * plano alimenta os seletores de disciplina/subtema dos dois formulários
 * (mesmo padrão do cronograma). As árvores carregadas ficam em cache para o
 * histórico resolver nomes de sessões de outros planos já visitados.
 */
@Component({
  selector: 'app-sessoes-page',
  imports: [FormsModule, Cronometro, RegistroManual, HistoricoSessoes],
  template: `
    <section class="sessoes">
      <h1>Estudar</h1>

      @if (planoError()) {
        <p class="alert alert--error" role="alert">{{ planoError() }}</p>
      }

      <div class="field sessoes__plano">
        <label for="sessoes-plano">Plano de estudo</label>
        <select id="sessoes-plano" [ngModel]="planoId()" (ngModelChange)="setPlano($event)">
          <option value="" disabled>
            {{ loadingPlanos() ? 'Carregando planos…' : 'Selecione um plano' }}
          </option>
          @for (plano of planos(); track plano.id) {
            <option [value]="plano.id">{{ plano.titulo }} ({{ plano.tipo }})</option>
          }
        </select>
        <span class="field__hint">As disciplinas e subtemas abaixo vêm do plano escolhido.</span>
      </div>

      <div class="sessoes__forms">
        <app-cronometro
          [disciplinas]="disciplinas()"
          [prefill]="prefill()"
          (finalizada)="onSessaoRegistrada()"
        />
        <app-registro-manual [disciplinas]="disciplinas()" (criada)="onSessaoRegistrada()" />
      </div>

      <app-historico-sessoes [disciplinas]="todasDisciplinas()" [refresh]="refreshTick()" />
    </section>
  `,
  styles: `
    .sessoes {
      display: grid;
      gap: 1rem;
      max-width: 64rem;
      margin: 0 auto;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .sessoes__plano {
      max-width: 28rem;
      margin-bottom: 0;
    }
    .sessoes__forms {
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
export default class SessoesPage {
  private readonly planosService = inject(PlanosService);
  private readonly cronogramaService = inject(CronogramaService);
  private readonly route = inject(ActivatedRoute);

  readonly loadingPlanos = signal(true);
  readonly planoError = signal<string | null>(null);

  readonly planos = signal<Plano[]>([]);
  readonly planoId = signal('');
  /** Cache das árvores carregadas (nomes para o histórico). */
  private readonly trees = signal<Map<string, PlanoTree>>(new Map());

  readonly prefill = signal<CronometroPrefill | null>(null);
  readonly refreshTick = signal(0);

  readonly disciplinas = computed<DisciplinaTree[]>(
    () => this.trees().get(this.planoId())?.disciplinas ?? [],
  );

  readonly todasDisciplinas = computed<DisciplinaTree[]>(() =>
    [...this.trees().values()].flatMap((tree) => tree.disciplinas),
  );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const disciplinaId = query.get('disciplinaId');
    if (disciplinaId) {
      this.prefill.set({
        disciplinaId,
        subtemaId: query.get('subtemaId') ?? undefined,
        blocoId: query.get('blocoId') ?? undefined,
      });
    }
    const planoQuery = query.get('planoId');
    if (planoQuery) this.setPlano(planoQuery);

    // Auto-seleção: (1) query param acima, (2) plano do cronograma ativo se
    // acessível, (3) plano único. planoPadraoId() nunca erra (404 → null).
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

  onSessaoRegistrada(): void {
    this.refreshTick.set(this.refreshTick() + 1);
  }
}

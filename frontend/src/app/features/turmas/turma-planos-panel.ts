import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { extractApiError, type ApiErrorDetail } from '../../core/http/api-error';
import type { Plano } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { TurmaPlanosService } from './turma-planos.service';
import type { TurmaPlano } from './turmas.models';

/** Planos OFICIAIS vinculados à turma (visão do professor dono/moderação). */
@Component({
  selector: 'app-turma-planos-panel',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="card tplanos" aria-labelledby="tplanos-titulo">
      <h2 id="tplanos-titulo">Planos da turma</h2>
      <p class="tplanos__hint">
        Apenas planos OFICIAIS publicados podem ser vinculados. Os alunos matriculados enxergam
        esta lista.
      </p>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }
      @if (errorDetails().length > 0) {
        <ul class="alert alert--error tplanos__details" role="alert">
          @for (detail of errorDetails(); track $index) {
            <li>{{ detail.field }}: {{ detail.issue }}</li>
          }
        </ul>
      }

      <form class="tplanos__vincular" (submit)="vincular($event)">
        <div class="field tplanos__select">
          <label for="tplanos-plano">Vincular plano oficial</label>
          <select
            id="tplanos-plano"
            [ngModel]="planoSelecionado()"
            (ngModelChange)="planoSelecionado.set($event)"
            name="plano"
            [disabled]="loadingOficiais()"
          >
            <option value="">
              {{ loadingOficiais() ? 'Carregando planos…' : 'Selecione um plano' }}
            </option>
            @for (plano of oficiaisDisponiveis(); track plano.id) {
              <option [value]="plano.id">{{ plano.titulo }}</option>
            }
          </select>
          @if (!loadingOficiais() && oficiaisDisponiveis().length === 0) {
            <span class="field__hint">Nenhum plano oficial publicado disponível para vincular.</span>
          }
        </div>
        <button
          class="btn btn--primary"
          type="submit"
          [disabled]="!planoSelecionado() || vinculando()"
        >
          {{ vinculando() ? 'Vinculando…' : 'Vincular' }}
        </button>
      </form>

      @if (loading()) {
        <p class="tplanos__state">Carregando planos vinculados…</p>
      } @else if (vinculados().length === 0) {
        <p class="tplanos__state">Nenhum plano vinculado a esta turma ainda.</p>
      } @else {
        <ul class="tplanos__lista">
          @for (vinculo of vinculados(); track vinculo.id) {
            <li class="tplanos__item">
              <a class="tplanos__titulo" [routerLink]="['/planos', vinculo.planoId]">
                {{ vinculo.plano?.titulo ?? 'Plano' }}
              </a>
              <button
                class="btn btn--outline btn--sm tplanos__remover"
                type="button"
                [disabled]="removendoId() === vinculo.id"
                [attr.aria-label]="'Desvincular o plano ' + (vinculo.plano?.titulo ?? '')"
                (click)="desvincular(vinculo)"
              >
                {{ removendoId() === vinculo.id ? 'Removendo…' : 'Desvincular' }}
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .tplanos {
      display: grid;
      gap: 0.75rem;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
    .tplanos__hint {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .tplanos__details {
      margin: 0;
      padding-left: 2rem;
    }
    .tplanos__vincular {
      display: flex;
      align-items: end;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .tplanos__select {
      flex: 1;
      min-width: 14rem;
      margin-bottom: 0;
    }
    .tplanos__state {
      margin: 0;
      color: var(--color-text-muted);
      text-align: center;
      padding: 1.5rem 0;
    }
    .tplanos__lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.25rem;
    }
    .tplanos__item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 44px;
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--color-border);

      &:last-child {
        border-bottom: none;
      }
    }
    .tplanos__titulo {
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 500;
      text-decoration: none;

      &:hover,
      &:focus-visible {
        text-decoration: underline;
      }
    }
    .tplanos__remover {
      flex-shrink: 0;
      color: var(--color-danger);
      border-color: var(--color-danger);
    }
  `,
})
export class TurmaPlanosPanel {
  private readonly turmaPlanosService = inject(TurmaPlanosService);
  private readonly planosService = inject(PlanosService);

  readonly turmaId = input.required<string>();

  readonly vinculados = signal<TurmaPlano[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly errorDetails = signal<ApiErrorDetail[]>([]);

  readonly oficiais = signal<Plano[]>([]);
  readonly loadingOficiais = signal(true);

  readonly planoSelecionado = signal('');
  readonly vinculando = signal(false);
  readonly removendoId = signal<string | null>(null);

  /** Oficiais publicados que ainda não estão vinculados à turma. */
  readonly oficiaisDisponiveis = computed(() => {
    const vinculadosIds = new Set(this.vinculados().map((v) => v.planoId));
    return this.oficiais().filter((plano) => !vinculadosIds.has(plano.id));
  });

  constructor() {
    this.planosService
      .list({ tipo: 'OFICIAL', publicado: true, page: 1, pageSize: 100, sort: 'titulo' })
      .subscribe({
        next: (res) => {
          this.oficiais.set(res.data);
          this.loadingOficiais.set(false);
        },
        error: (err: unknown) => {
          this.loadingOficiais.set(false);
          this.error.set(extractApiError(err).message);
        },
      });

    effect(() => {
      this.turmaId();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.loading.set(true);
    // vínculos por turma são poucos: uma página larga cobre o painel
    this.turmaPlanosService.list(this.turmaId(), { page: 1, pageSize: 100 }).subscribe({
      next: (res) => {
        this.vinculados.set(res.data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(extractApiError(err).message);
      },
    });
  }

  vincular(event: Event): void {
    event.preventDefault();
    const planoId = this.planoSelecionado();
    if (!planoId || this.vinculando()) return;

    this.vinculando.set(true);
    this.error.set(null);
    this.errorDetails.set([]);
    this.turmaPlanosService.vincular(this.turmaId(), planoId).subscribe({
      next: (vinculo) => {
        this.vinculando.set(false);
        this.planoSelecionado.set('');
        this.vinculados.set([...this.vinculados(), vinculo]);
      },
      error: (err: unknown) => {
        this.vinculando.set(false);
        const apiError = extractApiError(err);
        this.error.set(
          apiError.code === 'CONFLICT'
            ? 'Este plano já está vinculado à turma.'
            : apiError.message,
        );
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
          this.errorDetails.set(apiError.details);
        }
      },
    });
  }

  desvincular(vinculo: TurmaPlano): void {
    const titulo = vinculo.plano?.titulo ?? 'este plano';
    if (!confirm(`Desvincular "${titulo}" da turma? Os alunos deixam de vê-lo na turma.`)) return;

    this.error.set(null);
    this.errorDetails.set([]);
    this.removendoId.set(vinculo.id);
    this.turmaPlanosService.desvincular(this.turmaId(), vinculo.planoId).subscribe({
      next: () => {
        this.removendoId.set(null);
        this.vinculados.set(this.vinculados().filter((v) => v.id !== vinculo.id));
      },
      error: (err: unknown) => {
        this.removendoId.set(null);
        this.error.set(extractApiError(err).message);
      },
    });
  }
}

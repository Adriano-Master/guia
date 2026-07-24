import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { extractApiError } from '../../core/http/api-error';
import type { Desempenho } from './questoes.models';
import { QuestoesService } from './questoes.service';

/**
 * Faixas da taxa de erro agregada (US-4): ≥50% alta (--danger, o LIMIAR default
 * da recomendação na Fase 2), ≥25% média (--warning), abaixo baixa (--success).
 * A cor SEMPRE acompanha o valor em texto — nunca é o único canal.
 */
const TAXA_ALTA = 0.5;
const TAXA_MEDIA = 0.25;

/** Painel de desempenho agregado por tema (CA-8, CB-3) — GET /questoes/desempenho. */
@Component({
  selector: 'app-desempenho-questoes',
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <div class="card qdes">
      <h2 class="qdes__title">Desempenho por tema</h2>
      <p class="qdes__hint">Taxa de erro agregada no período (padrão: últimos 30 dias).</p>

      <div class="qdes__filters">
        <div class="field">
          <label for="qdes-from">De</label>
          <input id="qdes-from" type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)" />
        </div>
        <div class="field">
          <label for="qdes-to">Até</label>
          <input id="qdes-to" type="date" [ngModel]="to()" (ngModelChange)="setTo($event)" />
        </div>
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="qdes__state">Carregando desempenho…</p>
      } @else if (result(); as res) {
        <p class="qdes__periodo">
          Período: {{ res.from | date: 'dd/MM/yyyy' }} a {{ res.to | date: 'dd/MM/yyyy' }}
        </p>

        @if (res.data.length === 0) {
          <p class="qdes__state">Nenhuma questão registrada no período.</p>
        } @else {
          <ul class="qdes__lista">
            @for (item of res.data; track item.temaId) {
              <li class="qdes__item">
                <div class="qdes__item-header">
                  <span class="qdes__tema">{{ item.temaNome }}</span>
                  <span class="qdes__taxa" [class]="'qdes__taxa--' + nivel(item.taxaErro)">
                    {{ item.taxaErro * 100 | number: '1.0-1' }}%
                  </span>
                </div>
                <div class="qdes__bar" aria-hidden="true">
                  <div
                    class="qdes__bar-fill"
                    [class]="'qdes__bar-fill--' + nivel(item.taxaErro)"
                    [style.width.%]="item.taxaErro * 100"
                  ></div>
                </div>
                <span class="qdes__contagem">
                  {{ item.totalErros }} erros em {{ item.totalQuestoes }} questões
                </span>
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: `
    .qdes {
      display: grid;
      gap: 0.75rem;
      align-content: start;
    }
    .qdes__title {
      margin: 0;
      font-size: 1.125rem;
    }
    .qdes__hint {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    .qdes__filters {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr 1fr;

      .field {
        margin-bottom: 0;
      }
    }
    .qdes__periodo {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
    .qdes__state {
      margin: 0;
      color: var(--text-secondary);
      text-align: center;
      padding: 1.5rem 0;
    }
    .qdes__lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    /* Item de lista SEM vidro próprio (§6): painel rebaixado dentro do card. */
    .qdes__item {
      display: grid;
      gap: 0.375rem;
      padding: 0.75rem;
      background: var(--surface-inset);
      border: 1px solid var(--glass-border);
      border-radius: 0.5rem;
    }
    .qdes__item-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .qdes__tema {
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 600;
      font-size: 0.9375rem;
    }
    .qdes__taxa {
      flex-shrink: 0;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .qdes__taxa--alta {
      color: var(--danger);
    }
    .qdes__taxa--media {
      color: var(--warning);
    }
    .qdes__taxa--baixa {
      color: var(--success);
    }
    .qdes__bar {
      height: 0.5rem;
      border-radius: 999px;
      background: var(--surface-inset);
      border: 1px solid var(--glass-border);
      overflow: hidden;
    }
    .qdes__bar-fill {
      height: 100%;
      border-radius: inherit;
    }
    .qdes__bar-fill--alta {
      background: var(--danger);
    }
    .qdes__bar-fill--media {
      background: var(--warning);
    }
    .qdes__bar-fill--baixa {
      background: var(--success);
    }
    .qdes__contagem {
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
  `,
})
export class DesempenhoQuestoes {
  private readonly questoesService = inject(QuestoesService);

  /** Incrementado pelo pai quando registros mudam (criar/editar/excluir). */
  readonly refresh = input(0);

  readonly from = signal('');
  readonly to = signal('');

  readonly result = signal<Desempenho | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  constructor() {
    // Rastreia APENAS refresh(); load() lê os filtros sincronamente (mesmo
    // padrão do histórico — os setters já chamam load()).
    effect(() => {
      this.refresh();
      untracked(() => this.load());
    });
  }

  nivel(taxa: number): 'alta' | 'media' | 'baixa' {
    if (taxa >= TAXA_ALTA) return 'alta';
    if (taxa >= TAXA_MEDIA) return 'media';
    return 'baixa';
  }

  setFrom(value: string): void {
    this.from.set(value);
    this.load();
  }

  setTo(value: string): void {
    this.to.set(value);
    this.load();
  }

  load(): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.questoesService
      .desempenho({
        // Dias de calendário, ambos inclusivos; omitidos → backend aplica 30 dias.
        from: this.from() || undefined,
        to: this.to() || undefined,
      })
      .subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          if (seq !== this.loadSeq) return;
          this.loading.set(false);
          this.error.set(extractApiError(err).message);
        },
      });
  }
}

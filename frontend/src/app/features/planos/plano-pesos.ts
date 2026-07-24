import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { extractApiError } from '../../core/http/api-error';
import type { PlanoTree } from './planos.models';
import { PlanosService } from './planos.service';

const TARGET_CENTS = 100 * 100;

@Component({
  selector: 'app-plano-pesos',
  template: `
    <div class="card pesos">
      <div class="pesos__header">
        <h2>Pesos por disciplina</h2>
        @if (plano().disciplinas.length > 0) {
          <span
            class="pesos__sum"
            [class.pesos__sum--ok]="sumCents() === targetCents"
            [class.pesos__sum--bad]="sumCents() !== targetCents"
            role="status"
            aria-live="polite"
          >
            Soma: {{ sumLabel() }} / 100.00
          </span>
        }
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }
      @if (saved()) {
        <p class="alert alert--success" role="status">Pesos salvos com sucesso.</p>
      }

      @if (plano().disciplinas.length === 0) {
        <p class="pesos__empty">Adicione disciplinas ao plano para definir os pesos.</p>
      } @else {
        <ul class="pesos__list">
          @for (disciplina of plano().disciplinas; track disciplina.id) {
            <li class="pesos__row">
              <label class="pesos__label" [for]="'peso-' + disciplina.id">{{
                disciplina.nome
              }}</label>
              <div class="pesos__control">
                <input
                  [id]="'peso-' + disciplina.id"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  [value]="valueFor(disciplina.id)"
                  (input)="setValue(disciplina.id, $any($event.target).value)"
                  [disabled]="!canEdit() || saving()"
                  [class.pesos__input--invalid]="centsFor(disciplina.id) === null"
                />
                <span aria-hidden="true">%</span>
              </div>
            </li>
          }
        </ul>

        @if (canEdit()) {
          <div class="pesos__footer">
            @if (sumCents() !== targetCents) {
              <p class="pesos__hint" role="status">
                A soma dos pesos deve ser exatamente 100.00 para salvar.
              </p>
            }
            <button
              class="btn btn--primary"
              type="button"
              [disabled]="saving() || sumCents() !== targetCents"
              (click)="save()"
            >
              {{ saving() ? 'Salvando…' : 'Salvar pesos' }}
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .pesos {
      display: grid;
      gap: 0.75rem;
    }
    .pesos__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
    .pesos__sum {
      font-size: 0.875rem;
      font-weight: 700;
      padding: 0.25rem 0.625rem;
      border-radius: 999px;
    }
    .pesos__sum--ok {
      background: var(--color-success-bg);
      color: var(--color-success);
    }
    .pesos__sum--bad {
      background: var(--color-danger-bg);
      color: var(--color-danger);
    }
    .pesos__empty {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.9375rem;
    }
    .pesos__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    .pesos__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .pesos__label {
      font-size: 0.9375rem;
      font-weight: 500;
    }
    .pesos__control {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--color-text-muted);

      input {
        width: 7rem;
        min-height: 44px;
        padding: 0 0.75rem;
        font-size: 1rem;
        font-family: inherit;
        text-align: right;
        color: var(--color-text);
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;

        &:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 1px;
        }
        &:disabled {
          opacity: 0.7;
        }
      }
    }
    .pesos__input--invalid {
      border-color: var(--color-danger) !important;
    }
    .pesos__footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .pesos__hint {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
  `,
})
export class PlanoPesosComponent {
  private readonly planosService = inject(PlanosService);

  readonly plano = input.required<PlanoTree>();
  readonly canEdit = input.required<boolean>();
  readonly changed = output<void>();

  readonly targetCents = TARGET_CENTS;

  readonly values = signal<Record<string, string>>({});
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);

  /** Soma em centésimos (inteiros) para evitar erro de ponto flutuante; null se algum valor for inválido. */
  readonly sumCents = computed<number | null>(() => {
    let sum = 0;
    for (const disciplina of this.plano().disciplinas) {
      const cents = this.centsFor(disciplina.id);
      if (cents === null) return null;
      sum += cents;
    }
    return sum;
  });

  readonly sumLabel = computed(() => {
    const cents = this.sumCents();
    return cents === null ? '—' : (cents / 100).toFixed(2);
  });

  constructor() {
    // O effect depende SÓ de plano(): initFromPlano lê e escreve values, e
    // fora de untracked() isso faria o effect depender do próprio signal que
    // escreve → reagendamento infinito (NG0103).
    effect(() => {
      const plano = this.plano();
      untracked(() => this.initFromPlano(plano));
    });
  }

  valueFor(disciplinaId: string): string {
    return this.values()[disciplinaId] ?? '0';
  }

  setValue(disciplinaId: string, value: string): void {
    this.saved.set(false);
    this.values.set({ ...this.values(), [disciplinaId]: value });
  }

  centsFor(disciplinaId: string): number | null {
    return toCents(this.valueFor(disciplinaId));
  }

  save(): void {
    if (this.sumCents() !== TARGET_CENTS) return;

    const pesos = this.plano().disciplinas.map((disciplina) => ({
      disciplinaId: disciplina.id,
      pesoPercentual: (this.centsFor(disciplina.id) ?? 0) / 100,
    }));

    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);
    this.planosService.setPesos(this.plano().id, pesos).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const apiError = extractApiError(err);
        if (apiError.code === 'FORBIDDEN') {
          this.error.set('Você não tem permissão para alterar os pesos deste plano.');
        } else if (apiError.details?.length) {
          this.error.set(
            apiError.details.map((d) => `${d.field}: ${d.issue}`).join(' · ') || apiError.message,
          );
        } else {
          this.error.set(apiError.message);
        }
      },
    });
  }

  private initFromPlano(plano: PlanoTree): void {
    const next: Record<string, string> = {};
    for (const disciplina of plano.disciplinas) {
      const peso = plano.pesos.find((p) => p.disciplinaId === disciplina.id);
      const current = this.values()[disciplina.id];
      next[disciplina.id] = current ?? (peso ? Number(peso.pesoPercentual).toFixed(2) : '0');
    }
    this.values.set(next);
  }
}

/** Converte "12.34" em 1234 (centésimos), com no máximo 2 casas; null se inválido. */
function toCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return null;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 100) return null;
  const cents = Math.round(num * 100);
  if (Math.abs(num * 100 - cents) > 1e-6) return null;
  return cents;
}

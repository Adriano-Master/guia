import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { Paginated } from '../../core/auth/auth.models';
import { extractApiError } from '../../core/http/api-error';
import type { DisciplinaTree } from '../planos/planos.models';
import type { Sessao } from './sessoes.models';
import { SessaoService } from './sessoes.service';

const PAGE_SIZE = 10;
const DIA_MS = 86_400_000;

/** Histórico paginado de sessões com filtros e correções pós-registro (US-6, RN-7). */
@Component({
  selector: 'app-historico-sessoes',
  imports: [DatePipe, FormsModule],
  template: `
    <section class="hist">
      <h2 class="hist__title">Histórico de sessões</h2>

      <div class="hist__filters">
        <div class="field">
          <label for="hist-disciplina">Disciplina</label>
          <select
            id="hist-disciplina"
            [ngModel]="disciplinaFilter()"
            (ngModelChange)="setDisciplinaFilter($event)"
          >
            <option value="">Todas</option>
            @for (disciplina of disciplinas(); track disciplina.id) {
              <option [value]="disciplina.id">{{ disciplina.nome }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="hist-from">De</label>
          <input id="hist-from" type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)" />
        </div>
        <div class="field">
          <label for="hist-to">Até</label>
          <input id="hist-to" type="date" [ngModel]="to()" (ngModelChange)="setTo($event)" />
        </div>
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="hist__state">Carregando sessões…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <p class="hist__state">Nenhuma sessão encontrada com os filtros atuais.</p>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Disciplina</th>
                  <th>Subtema</th>
                  <th>Origem</th>
                  <th>Duração</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (sessao of res.data; track sessao.id) {
                  <tr>
                    <td>
                      @if (sessao.origem === 'MANUAL') {
                        {{ sessao.inicio | date: 'dd/MM/yyyy' : 'UTC' }}
                      } @else {
                        {{ sessao.inicio | date: 'dd/MM/yyyy HH:mm' }}
                      }
                    </td>
                    <td>{{ disciplinaNome(sessao.disciplinaId) }}</td>
                    <td>{{ sessao.subtemaId ? subtemaNome(sessao.subtemaId) : '—' }}</td>
                    <td>
                      <span class="badge">
                        {{ sessao.origem === 'CRONOMETRO' ? 'Cronômetro' : 'Manual' }}
                      </span>
                    </td>
                    @if (editingId() === sessao.id) {
                      <td>
                        <input
                          class="hist__edit-input"
                          type="number"
                          min="1"
                          step="1"
                          inputmode="numeric"
                          aria-label="Duração em minutos"
                          [ngModel]="editDuracao()"
                          (ngModelChange)="editDuracao.set($event)"
                        />
                      </td>
                      <td class="hist__acoes">
                        <button
                          class="btn btn--primary btn--sm"
                          type="button"
                          [disabled]="saving() || !editValida()"
                          (click)="saveEdit(sessao)"
                        >
                          {{ saving() ? 'Salvando…' : 'Salvar' }}
                        </button>
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          [disabled]="saving()"
                          (click)="cancelEdit()"
                        >
                          Cancelar
                        </button>
                      </td>
                    } @else {
                      <td>
                        {{ sessao.fim === null ? 'em andamento' : sessao.duracaoMin + ' min' }}
                      </td>
                      <td class="hist__acoes">
                        @if (sessao.fim !== null) {
                          <button
                            class="btn btn--outline btn--sm"
                            type="button"
                            (click)="startEdit(sessao)"
                          >
                            Editar
                          </button>
                          <button
                            class="btn btn--outline btn--sm hist__excluir"
                            type="button"
                            (click)="excluir(sessao)"
                          >
                            Excluir
                          </button>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="hist__pagination">
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              Anterior
            </button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ res.total }} sessões</span>
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() >= totalPages()"
              (click)="goToPage(page() + 1)"
            >
              Próxima
            </button>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .hist {
      display: grid;
      gap: 0.75rem;
    }
    .hist__title {
      margin: 0;
      font-size: 1.125rem;
    }
    .hist__filters {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      .field {
        margin-bottom: 0;
      }

      @media (min-width: 640px) {
        grid-template-columns: 2fr 1fr 1fr;
      }
    }
    .hist__state {
      margin: 0;
      color: var(--color-text-muted);
      text-align: center;
      padding: 1.5rem 0;
    }
    .hist__acoes {
      white-space: nowrap;

      .btn + .btn {
        margin-left: 0.5rem;
      }
    }
    .hist__excluir {
      color: var(--color-danger);
    }
    .hist__edit-input {
      width: 5.5rem;
      min-height: 36px;
      padding: 0 0.5rem;
      font: inherit;
      color: var(--color-text);
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: 0.375rem;
    }
    .hist__pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }
  `,
})
export class HistoricoSessoes {
  private readonly sessaoService = inject(SessaoService);

  /** Disciplinas conhecidas (todos os planos já carregados) para filtro e nomes. */
  readonly disciplinas = input<DisciplinaTree[]>([]);
  /** Incrementado pelo pai quando uma sessão nova é registrada. */
  readonly refresh = input(0);

  readonly page = signal(1);
  readonly disciplinaFilter = signal('');
  readonly from = signal('');
  readonly to = signal('');

  readonly result = signal<Paginated<Sessao> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly editingId = signal<string | null>(null);
  readonly editDuracao = signal<number | null>(null);
  readonly saving = signal(false);

  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  readonly editValida = computed(() => {
    const valor = Number(this.editDuracao());
    return Number.isInteger(valor) && valor > 0;
  });

  private readonly disciplinaNomes = computed(() => {
    const nomes = new Map<string, string>();
    for (const d of this.disciplinas()) nomes.set(d.id, d.nome);
    return nomes;
  });

  private readonly subtemaNomes = computed(() => {
    const nomes = new Map<string, string>();
    for (const d of this.disciplinas()) {
      for (const t of d.temas) {
        for (const s of t.subtemas) nomes.set(s.id, s.nome);
      }
    }
    return nomes;
  });

  constructor() {
    // Rastreia APENAS refresh(): load() lê page/filtros sincronamente e, sem o
    // untracked, cada interação dispararia uma segunda requisição idêntica no
    // flush do effect (os setters já chamam load() manualmente).
    effect(() => {
      this.refresh();
      untracked(() => this.load());
    });
  }

  disciplinaNome(id: string): string {
    return this.disciplinaNomes().get(id) ?? '—';
  }

  subtemaNome(id: string): string {
    return this.subtemaNomes().get(id) ?? '—';
  }

  setDisciplinaFilter(value: string): void {
    this.disciplinaFilter.set(value);
    this.page.set(1);
    this.load();
  }

  setFrom(value: string): void {
    this.from.set(value);
    this.page.set(1);
    this.load();
  }

  setTo(value: string): void {
    this.to.set(value);
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.editingId.set(null);
    this.sessaoService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        sort: '-inicio',
        disciplinaId: this.disciplinaFilter() || undefined,
        from: this.fromIso(),
        to: this.toIso(),
      })
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(extractApiError(err).message);
        },
      });
  }

  startEdit(sessao: Sessao): void {
    this.error.set(null);
    this.editingId.set(sessao.id);
    this.editDuracao.set(sessao.duracaoMin);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(sessao: Sessao): void {
    if (!this.editValida()) return;
    this.saving.set(true);
    this.error.set(null);
    this.sessaoService.update(sessao.id, { duracaoMin: Number(this.editDuracao()) }).subscribe({
      next: (atualizada) => {
        this.saving.set(false);
        this.editingId.set(null);
        const res = this.result();
        if (res) {
          this.result.set({
            ...res,
            data: res.data.map((s) => (s.id === atualizada.id ? atualizada : s)),
          });
        }
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractApiError(err).message);
      },
    });
  }

  excluir(sessao: Sessao): void {
    const min = `${sessao.duracaoMin} min`;
    if (!confirm(`Excluir esta sessão de ${min}? A ação não pode ser desfeita.`)) return;
    this.error.set(null);
    this.sessaoService.remove(sessao.id).subscribe({
      next: () => {
        // Volta uma página se a última linha da página foi removida.
        const res = this.result();
        if (res && res.data.length === 1 && this.page() > 1) this.page.set(this.page() - 1);
        this.load();
      },
      error: (err: unknown) => this.error.set(extractApiError(err).message),
    });
  }

  /**
   * Fronteiras dos filtros em dias UTC: registros manuais são ancorados em
   * `data@00:00Z` no backend, então dias UTC garantem que a sessão manual do
   * próprio dia entre no intervalo (com dia local, ficaria de fora em TZ < 0).
   */
  private fromIso(): string | undefined {
    const from = this.from();
    return from ? `${from}T00:00:00.000Z` : undefined;
  }

  /** `Até` é inclusivo na UI → fronteira exclusiva no dia UTC seguinte. */
  private toIso(): string | undefined {
    const to = this.to();
    if (!to) return undefined;
    return new Date(new Date(`${to}T00:00:00Z`).getTime() + DIA_MS).toISOString();
  }
}

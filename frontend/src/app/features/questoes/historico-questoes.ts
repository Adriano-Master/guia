import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { Paginated } from '../../core/auth/auth.models';
import { extractApiError } from '../../core/http/api-error';
import type { DisciplinaTree, TemaTree } from '../planos/planos.models';
import type { RegistroQuestoes, UpdateRegistroInput } from './questoes.models';
import { hojeLocal } from './questoes.models';
import { QuestoesService } from './questoes.service';

const PAGE_SIZE = 10;

/** Histórico paginado de registros com filtros e edição/exclusão (US-2, US-3). */
@Component({
  selector: 'app-historico-questoes',
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <section class="qhist">
      <h2 class="qhist__title">Histórico de registros</h2>

      <div class="qhist__filters">
        <div class="field">
          <label for="qhist-tema">Tema</label>
          <select id="qhist-tema" [ngModel]="temaFilter()" (ngModelChange)="setTemaFilter($event)">
            <option value="">Todos</option>
            @for (disciplina of disciplinasComTemas(); track disciplina.id) {
              <optgroup [label]="disciplina.nome">
                @for (tema of disciplina.temas; track tema.id) {
                  <option [value]="tema.id">{{ tema.nome }}</option>
                }
              </optgroup>
            }
          </select>
        </div>
        <div class="field">
          <label for="qhist-from">De</label>
          <input id="qhist-from" type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)" />
        </div>
        <div class="field">
          <label for="qhist-to">Até</label>
          <input id="qhist-to" type="date" [ngModel]="to()" (ngModelChange)="setTo($event)" />
        </div>
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="qhist__state">Carregando registros…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <p class="qhist__state">Nenhum registro encontrado com os filtros atuais.</p>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tema</th>
                  <th>Subtema</th>
                  <th>Total</th>
                  <th>Erros</th>
                  <th>Taxa de erro</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (registro of res.data; track registro.id) {
                  <tr>
                    @if (editingId() === registro.id) {
                      <td>
                        <input
                          class="qhist__edit-input qhist__edit-input--data"
                          type="date"
                          [max]="hoje"
                          aria-label="Data do registro"
                          [attr.aria-invalid]="editDataError() !== null ? true : null"
                          [attr.aria-describedby]="
                            editDataError() !== null ? 'qhist-edit-data-erro' : null
                          "
                          [ngModel]="editData()"
                          (ngModelChange)="editData.set($event)"
                        />
                        @if (editDataError(); as erro) {
                          <span id="qhist-edit-data-erro" class="field__error qhist__edit-erro">
                            {{ erro }}
                          </span>
                        }
                      </td>
                      <td>{{ temaNomeDe(registro) }}</td>
                      <td>
                        @if (temaTreeDe(registro.temaId); as tema) {
                          <select
                            class="qhist__edit-input qhist__edit-input--subtema"
                            aria-label="Subtema do registro"
                            [ngModel]="editSubtemaId()"
                            (ngModelChange)="editSubtemaId.set($event)"
                          >
                            <option value="">Sem subtema</option>
                            @for (subtema of tema.subtemas; track subtema.id) {
                              <option [value]="subtema.id">{{ subtema.nome }}</option>
                            }
                          </select>
                        } @else {
                          {{ subtemaNomeDe(registro) }}
                        }
                      </td>
                      <td>
                        <input
                          class="qhist__edit-input"
                          type="number"
                          min="1"
                          step="1"
                          inputmode="numeric"
                          aria-label="Total de questões"
                          [attr.aria-invalid]="editTotalError() !== null ? true : null"
                          [attr.aria-describedby]="
                            editTotalError() !== null ? 'qhist-edit-total-erro' : null
                          "
                          [ngModel]="editTotal()"
                          (ngModelChange)="editTotal.set($event)"
                        />
                        @if (editTotalError(); as erro) {
                          <span id="qhist-edit-total-erro" class="field__error qhist__edit-erro">
                            {{ erro }}
                          </span>
                        }
                      </td>
                      <td>
                        <input
                          class="qhist__edit-input"
                          type="number"
                          min="0"
                          step="1"
                          inputmode="numeric"
                          aria-label="Erros"
                          [attr.aria-invalid]="editErrosError() !== null ? true : null"
                          [attr.aria-describedby]="
                            editErrosError() !== null ? 'qhist-edit-erros-erro' : null
                          "
                          [ngModel]="editErros()"
                          (ngModelChange)="editErros.set($event)"
                        />
                        @if (editErrosError(); as erro) {
                          <span id="qhist-edit-erros-erro" class="field__error qhist__edit-erro">
                            {{ erro }}
                          </span>
                        }
                      </td>
                      <td>
                        @if (editTaxa(); as taxa) {
                          {{ taxa.pct | number: '1.0-1' }}%
                        } @else {
                          —
                        }
                      </td>
                      <td class="qhist__acoes">
                        <button
                          class="btn btn--primary btn--sm"
                          type="button"
                          [disabled]="saving() || !editValida()"
                          (click)="saveEdit(registro)"
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
                      <td>{{ registro.data | date: 'dd/MM/yyyy' }}</td>
                      <td>{{ temaNomeDe(registro) }}</td>
                      <td>{{ subtemaNomeDe(registro) }}</td>
                      <td>{{ registro.total }}</td>
                      <td>{{ registro.erros }}</td>
                      <td>{{ registro.taxaErro * 100 | number: '1.0-1' }}%</td>
                      <td class="qhist__acoes">
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          (click)="startEdit(registro)"
                        >
                          Editar
                        </button>
                        <button
                          class="btn btn--outline btn--sm qhist__excluir"
                          type="button"
                          (click)="excluir(registro)"
                        >
                          Excluir
                        </button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="qhist__pagination">
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              Anterior
            </button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ res.total }} registros</span>
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
    .qhist {
      display: grid;
      gap: 0.75rem;
    }
    .qhist__title {
      margin: 0;
      font-size: 1.125rem;
    }
    .qhist__filters {
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
    .qhist__state {
      margin: 0;
      color: var(--text-secondary);
      text-align: center;
      padding: 1.5rem 0;
    }
    .qhist__acoes {
      white-space: nowrap;

      .btn + .btn {
        margin-left: 0.5rem;
      }
    }
    .qhist__excluir {
      color: var(--danger);
    }
    .qhist__edit-input {
      width: 5rem;
      min-height: 36px;
      padding: 0 0.5rem;
      font: inherit;
      color: var(--text-primary);
      background: var(--surface-inset);
      border: 1px solid var(--glass-border);
      border-radius: 0.375rem;
    }
    .qhist__edit-input--data {
      width: 10rem;
    }
    .qhist__edit-input--subtema {
      width: 12rem;
    }
    .qhist__edit-input[aria-invalid='true'] {
      border-color: var(--danger);
    }
    .qhist__edit-erro {
      display: block;
      margin-top: 0.25rem;
      max-width: 12rem;
      white-space: normal;
    }
    .qhist__pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }
  `,
})
export class HistoricoQuestoes {
  private readonly questoesService = inject(QuestoesService);

  /** Árvores conhecidas (todos os planos já carregados) para filtro e nomes. */
  readonly disciplinas = input<DisciplinaTree[]>([]);
  /** Incrementado pelo pai quando um registro novo é criado. */
  readonly refresh = input(0);
  /** Emitido após editar/excluir — o pai atualiza o painel de desempenho. */
  readonly alterado = output<void>();

  protected get hoje(): string {
    return hojeLocal();
  }

  readonly page = signal(1);
  readonly temaFilter = signal('');
  readonly from = signal('');
  readonly to = signal('');

  readonly result = signal<Paginated<RegistroQuestoes> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly editingId = signal<string | null>(null);
  readonly editData = signal('');
  readonly editSubtemaId = signal('');
  readonly editTotal = signal<number | null>(null);
  readonly editErros = signal<number | null>(null);
  readonly saving = signal(false);

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  readonly disciplinasComTemas = computed(() =>
    this.disciplinas().filter((d) => d.temas.length > 0),
  );

  /** Mesmas invariantes do form (RN-2, CA-3), com mensagem ao vivo por campo. */
  readonly editDataError = computed(() => {
    const data = this.editData();
    if (!data) return 'Informe a data.';
    if (data > this.hoje) return 'A data não pode ser futura.';
    return null;
  });

  readonly editTotalError = computed(() => {
    const total = this.editTotal();
    if (total === null || (total as unknown) === '') return 'Informe o total.';
    if (!Number.isInteger(Number(total))) return 'Use um número inteiro.';
    if (Number(total) < 1) return 'O total deve ser pelo menos 1.';
    return null;
  });

  readonly editErrosError = computed(() => {
    const erros = this.editErros();
    if (erros === null || (erros as unknown) === '') return 'Informe os erros.';
    if (!Number.isInteger(Number(erros))) return 'Use um número inteiro.';
    if (Number(erros) < 0) return 'Os erros não podem ser negativos.';
    if (this.editTotalError() === null && Number(erros) > Number(this.editTotal())) {
      return 'Os erros não podem exceder o total.';
    }
    return null;
  });

  readonly editValida = computed(
    () =>
      this.editDataError() === null &&
      this.editTotalError() === null &&
      this.editErrosError() === null,
  );

  readonly editTaxa = computed(() => {
    if (this.editTotalError() !== null || this.editErrosError() !== null) return null;
    return { pct: (Number(this.editErros()) / Number(this.editTotal())) * 100 };
  });

  private readonly temaNomes = computed(() => {
    const nomes = new Map<string, string>();
    for (const d of this.disciplinas()) {
      for (const t of d.temas) nomes.set(t.id, t.nome);
    }
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

  private readonly temaTrees = computed(() => {
    const trees = new Map<string, TemaTree>();
    for (const d of this.disciplinas()) {
      for (const t of d.temas) trees.set(t.id, t);
    }
    return trees;
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

  /** Nome do payload como fonte primária; fallback para as árvores carregadas. */
  temaNomeDe(registro: RegistroQuestoes): string {
    return registro.temaNome ?? this.temaNomes().get(registro.temaId) ?? '—';
  }

  subtemaNomeDe(registro: RegistroQuestoes): string {
    if (registro.subtemaId === null) return '—';
    return registro.subtemaNome ?? this.subtemaNomes().get(registro.subtemaId) ?? '—';
  }

  /** Árvore do tema (para o select de subtema na edição); null se o plano não foi carregado. */
  temaTreeDe(temaId: string): TemaTree | null {
    return this.temaTrees().get(temaId) ?? null;
  }

  setTemaFilter(value: string): void {
    this.temaFilter.set(value);
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
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.editingId.set(null);
    this.questoesService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        sort: '-data',
        temaId: this.temaFilter() || undefined,
        // Dias de calendário, from/to INCLUSIVOS (contrato de /questoes).
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

  startEdit(registro: RegistroQuestoes): void {
    this.error.set(null);
    this.editingId.set(registro.id);
    this.editData.set(registro.data);
    this.editSubtemaId.set(registro.subtemaId ?? '');
    this.editTotal.set(registro.total);
    this.editErros.set(registro.erros);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(registro: RegistroQuestoes): void {
    if (!this.editValida()) return;

    const payload: UpdateRegistroInput = {};
    if (Number(this.editTotal()) !== registro.total) payload.total = Number(this.editTotal());
    if (Number(this.editErros()) !== registro.erros) payload.erros = Number(this.editErros());
    if (this.editData() !== registro.data) payload.data = this.editData();
    // Só envia subtemaId se a árvore do tema está disponível (o select foi
    // exibido) e houve mudança — evita apagar o vínculo sem intenção.
    const subtemaId = this.editSubtemaId() || null;
    if (this.temaTreeDe(registro.temaId) !== null && subtemaId !== registro.subtemaId) {
      payload.subtemaId = subtemaId;
    }
    if (Object.keys(payload).length === 0) {
      this.cancelEdit();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    this.questoesService.update(registro.id, payload).subscribe({
      next: (atualizado) => {
        this.saving.set(false);
        this.editingId.set(null);
        const res = this.result();
        if (res) {
          this.result.set({
            ...res,
            data: res.data.map((r) => (r.id === atualizado.id ? atualizado : r)),
          });
        }
        this.alterado.emit();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const apiError = extractApiError(err);
        const issues = (apiError.details ?? []).map((d) => d.issue).join(' · ');
        this.error.set(issues ? `${apiError.message} ${issues}` : apiError.message);
      },
    });
  }

  excluir(registro: RegistroQuestoes): void {
    const quando = registro.data.split('-').reverse().join('/');
    if (
      !confirm(
        `Excluir o registro de ${registro.total} questões de ${quando}? A ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    this.error.set(null);
    this.questoesService.remove(registro.id).subscribe({
      next: () => {
        // Volta uma página se a última linha da página foi removida.
        const res = this.result();
        if (res && res.data.length === 1 && this.page() > 1) this.page.set(this.page() - 1);
        this.load();
        this.alterado.emit();
      },
      error: (err: unknown) => this.error.set(extractApiError(err).message),
    });
  }
}

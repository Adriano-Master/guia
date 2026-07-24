import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, Observable } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import type { DisciplinaTree, PlanoTree, Subtema, TemaTree } from './planos.models';
import { PlanosService } from './planos.service';

type NodeKind = 'disciplina' | 'tema' | 'subtema';

interface EditingNode {
  kind: NodeKind;
  id: string;
}

type AddingTarget =
  | { kind: 'disciplina' }
  | { kind: 'tema'; disciplinaId: string }
  | { kind: 'subtema'; temaId: string };

@Component({
  selector: 'app-plano-tree',
  imports: [FormsModule],
  template: `
    <div class="card tree">
      <div class="tree__header">
        <h2>Conteúdo</h2>
        @if (canEdit()) {
          <button
            class="btn btn--outline btn--sm"
            type="button"
            (click)="startAdd({ kind: 'disciplina' })"
          >
            + Disciplina
          </button>
        }
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (plano().disciplinas.length === 0) {
        <p class="tree__empty">
          Nenhuma disciplina ainda.
          @if (canEdit()) {
            Comece adicionando a primeira disciplina do plano.
          }
        </p>
      }

      <ul class="tree__list" role="tree" aria-label="Disciplinas do plano">
        @for (disciplina of plano().disciplinas; track disciplina.id; let di = $index) {
          <li role="treeitem" [attr.aria-expanded]="isExpanded('disciplina', disciplina.id)">
            <div class="tree__row tree__row--disciplina">
              <button
                class="tree__toggle"
                type="button"
                (click)="toggleExpanded('disciplina', disciplina.id)"
                [attr.aria-label]="
                  (isExpanded('disciplina', disciplina.id) ? 'Recolher ' : 'Expandir ') +
                  disciplina.nome
                "
              >
                {{ isExpanded('disciplina', disciplina.id) ? '▾' : '▸' }}
              </button>

              @if (isEditing('disciplina', disciplina.id)) {
                <input
                  class="tree__input"
                  type="text"
                  [ngModel]="editNome()"
                  (ngModelChange)="editNome.set($event)"
                  aria-label="Nome da disciplina"
                />
                <span class="tree__actions">
                  <button
                    class="btn btn--primary btn--sm"
                    type="button"
                    [disabled]="busy()"
                    (click)="saveEdit()"
                  >
                    Salvar
                  </button>
                  <button
                    class="btn btn--outline btn--sm"
                    type="button"
                    [disabled]="busy()"
                    (click)="cancelEdit()"
                  >
                    Cancelar
                  </button>
                </span>
              } @else {
                <span class="tree__name">{{ disciplina.nome }}</span>
                <span class="tree__count">{{ disciplina.temas.length }} tema(s)</span>
                @if (canEdit()) {
                  <span class="tree__actions">
                    <button
                      class="btn btn--outline btn--sm"
                      type="button"
                      [disabled]="di === 0 || busy()"
                      (click)="moveDisciplina(di, -1)"
                      aria-label="Mover disciplina para cima"
                    >
                      ↑
                    </button>
                    <button
                      class="btn btn--outline btn--sm"
                      type="button"
                      [disabled]="di === plano().disciplinas.length - 1 || busy()"
                      (click)="moveDisciplina(di, 1)"
                      aria-label="Mover disciplina para baixo"
                    >
                      ↓
                    </button>
                    <button
                      class="btn btn--outline btn--sm"
                      type="button"
                      [disabled]="busy()"
                      (click)="startEdit('disciplina', disciplina.id, disciplina.nome)"
                    >
                      Editar
                    </button>
                    <button
                      class="btn btn--outline btn--sm tree__danger"
                      type="button"
                      [disabled]="busy()"
                      (click)="removeDisciplina(disciplina)"
                    >
                      Remover
                    </button>
                  </span>
                }
              }
            </div>

            @if (isExpanded('disciplina', disciplina.id)) {
              <ul class="tree__list tree__list--nested" role="group">
                @for (tema of disciplina.temas; track tema.id; let ti = $index) {
                  <li role="treeitem" [attr.aria-expanded]="isExpanded('tema', tema.id)">
                    <div class="tree__row">
                      <button
                        class="tree__toggle"
                        type="button"
                        (click)="toggleExpanded('tema', tema.id)"
                        [attr.aria-label]="
                          (isExpanded('tema', tema.id) ? 'Recolher ' : 'Expandir ') + tema.nome
                        "
                      >
                        {{ isExpanded('tema', tema.id) ? '▾' : '▸' }}
                      </button>

                      @if (isEditing('tema', tema.id)) {
                        <input
                          class="tree__input"
                          type="text"
                          [ngModel]="editNome()"
                          (ngModelChange)="editNome.set($event)"
                          aria-label="Nome do tema"
                        />
                        <span class="tree__actions">
                          <button
                            class="btn btn--primary btn--sm"
                            type="button"
                            [disabled]="busy()"
                            (click)="saveEdit()"
                          >
                            Salvar
                          </button>
                          <button
                            class="btn btn--outline btn--sm"
                            type="button"
                            [disabled]="busy()"
                            (click)="cancelEdit()"
                          >
                            Cancelar
                          </button>
                        </span>
                      } @else {
                        <span class="tree__name">{{ tema.nome }}</span>
                        <span class="tree__count">{{ tema.subtemas.length }} subtema(s)</span>
                        @if (canEdit()) {
                          <span class="tree__actions">
                            <button
                              class="btn btn--outline btn--sm"
                              type="button"
                              [disabled]="ti === 0 || busy()"
                              (click)="moveTema(disciplina, ti, -1)"
                              aria-label="Mover tema para cima"
                            >
                              ↑
                            </button>
                            <button
                              class="btn btn--outline btn--sm"
                              type="button"
                              [disabled]="ti === disciplina.temas.length - 1 || busy()"
                              (click)="moveTema(disciplina, ti, 1)"
                              aria-label="Mover tema para baixo"
                            >
                              ↓
                            </button>
                            <button
                              class="btn btn--outline btn--sm"
                              type="button"
                              [disabled]="busy()"
                              (click)="startEdit('tema', tema.id, tema.nome)"
                            >
                              Editar
                            </button>
                            <button
                              class="btn btn--outline btn--sm tree__danger"
                              type="button"
                              [disabled]="busy()"
                              (click)="removeTema(tema)"
                            >
                              Remover
                            </button>
                          </span>
                        }
                      }
                    </div>

                    @if (isExpanded('tema', tema.id)) {
                      <ul class="tree__list tree__list--nested" role="group">
                        @for (subtema of tema.subtemas; track subtema.id; let si = $index) {
                          <li role="treeitem">
                            <div class="tree__row">
                              <span class="tree__leaf" aria-hidden="true">•</span>
                              @if (isEditing('subtema', subtema.id)) {
                                <input
                                  class="tree__input"
                                  type="text"
                                  [ngModel]="editNome()"
                                  (ngModelChange)="editNome.set($event)"
                                  aria-label="Nome do subtema"
                                />
                                <input
                                  class="tree__input tree__input--min"
                                  type="number"
                                  min="1"
                                  [ngModel]="editDuracao()"
                                  (ngModelChange)="editDuracao.set($event)"
                                  aria-label="Duração estimada em minutos"
                                  placeholder="min"
                                />
                                <span class="tree__actions">
                                  <button
                                    class="btn btn--primary btn--sm"
                                    type="button"
                                    [disabled]="busy()"
                                    (click)="saveEdit()"
                                  >
                                    Salvar
                                  </button>
                                  <button
                                    class="btn btn--outline btn--sm"
                                    type="button"
                                    [disabled]="busy()"
                                    (click)="cancelEdit()"
                                  >
                                    Cancelar
                                  </button>
                                </span>
                              } @else {
                                <span class="tree__name">{{ subtema.nome }}</span>
                                @if (subtema.duracaoEstimadaMin) {
                                  <span class="tree__count"
                                    >{{ subtema.duracaoEstimadaMin }} min</span
                                  >
                                }
                                @if (canEdit()) {
                                  <span class="tree__actions">
                                    <button
                                      class="btn btn--outline btn--sm"
                                      type="button"
                                      [disabled]="si === 0 || busy()"
                                      (click)="moveSubtema(tema, si, -1)"
                                      aria-label="Mover subtema para cima"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      class="btn btn--outline btn--sm"
                                      type="button"
                                      [disabled]="si === tema.subtemas.length - 1 || busy()"
                                      (click)="moveSubtema(tema, si, 1)"
                                      aria-label="Mover subtema para baixo"
                                    >
                                      ↓
                                    </button>
                                    <button
                                      class="btn btn--outline btn--sm"
                                      type="button"
                                      [disabled]="busy()"
                                      (click)="
                                        startEdit(
                                          'subtema',
                                          subtema.id,
                                          subtema.nome,
                                          subtema.duracaoEstimadaMin
                                        )
                                      "
                                    >
                                      Editar
                                    </button>
                                    <button
                                      class="btn btn--outline btn--sm tree__danger"
                                      type="button"
                                      [disabled]="busy()"
                                      (click)="removeSubtema(subtema)"
                                    >
                                      Remover
                                    </button>
                                  </span>
                                }
                              }
                            </div>
                          </li>
                        }
                        @if (canEdit()) {
                          <li>
                            @if (isAdding('subtema', tema.id)) {
                              <div class="tree__row tree__row--add">
                                <input
                                  class="tree__input"
                                  type="text"
                                  [ngModel]="newNome()"
                                  (ngModelChange)="newNome.set($event)"
                                  placeholder="Nome do subtema"
                                  aria-label="Nome do novo subtema"
                                />
                                <input
                                  class="tree__input tree__input--min"
                                  type="number"
                                  min="1"
                                  [ngModel]="newDuracao()"
                                  (ngModelChange)="newDuracao.set($event)"
                                  placeholder="min"
                                  aria-label="Duração estimada em minutos"
                                />
                                <span class="tree__actions">
                                  <button
                                    class="btn btn--primary btn--sm"
                                    type="button"
                                    [disabled]="busy() || !newNome().trim()"
                                    (click)="saveAdd()"
                                  >
                                    Adicionar
                                  </button>
                                  <button
                                    class="btn btn--outline btn--sm"
                                    type="button"
                                    [disabled]="busy()"
                                    (click)="cancelAdd()"
                                  >
                                    Cancelar
                                  </button>
                                </span>
                              </div>
                            } @else {
                              <button
                                class="tree__add"
                                type="button"
                                (click)="startAdd({ kind: 'subtema', temaId: tema.id })"
                              >
                                + Subtema
                              </button>
                            }
                          </li>
                        }
                      </ul>
                    }
                  </li>
                }
                @if (canEdit()) {
                  <li>
                    @if (isAdding('tema', disciplina.id)) {
                      <div class="tree__row tree__row--add">
                        <input
                          class="tree__input"
                          type="text"
                          [ngModel]="newNome()"
                          (ngModelChange)="newNome.set($event)"
                          placeholder="Nome do tema"
                          aria-label="Nome do novo tema"
                        />
                        <span class="tree__actions">
                          <button
                            class="btn btn--primary btn--sm"
                            type="button"
                            [disabled]="busy() || !newNome().trim()"
                            (click)="saveAdd()"
                          >
                            Adicionar
                          </button>
                          <button
                            class="btn btn--outline btn--sm"
                            type="button"
                            [disabled]="busy()"
                            (click)="cancelAdd()"
                          >
                            Cancelar
                          </button>
                        </span>
                      </div>
                    } @else {
                      <button
                        class="tree__add"
                        type="button"
                        (click)="startAdd({ kind: 'tema', disciplinaId: disciplina.id })"
                      >
                        + Tema
                      </button>
                    }
                  </li>
                }
              </ul>
            }
          </li>
        }
        @if (canEdit() && isAdding('disciplina')) {
          <li>
            <div class="tree__row tree__row--add">
              <input
                class="tree__input"
                type="text"
                [ngModel]="newNome()"
                (ngModelChange)="newNome.set($event)"
                placeholder="Nome da disciplina"
                aria-label="Nome da nova disciplina"
              />
              <span class="tree__actions">
                <button
                  class="btn btn--primary btn--sm"
                  type="button"
                  [disabled]="busy() || !newNome().trim()"
                  (click)="saveAdd()"
                >
                  Adicionar
                </button>
                <button
                  class="btn btn--outline btn--sm"
                  type="button"
                  [disabled]="busy()"
                  (click)="cancelAdd()"
                >
                  Cancelar
                </button>
              </span>
            </div>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .tree {
      display: grid;
      gap: 0.75rem;
    }
    .tree__header {
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
    .tree__empty {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.9375rem;
    }
    .tree__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.25rem;
    }
    .tree__list--nested {
      margin: 0.25rem 0 0.5rem;
      padding-left: 1rem;
      border-left: 2px solid var(--color-border);
    }
    .tree__row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.25rem 0;
    }
    .tree__row--disciplina .tree__name {
      font-weight: 600;
    }
    .tree__toggle {
      all: unset;
      cursor: pointer;
      min-width: 2rem;
      min-height: 2rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 0.375rem;
      color: var(--color-text-muted);

      &:hover {
        background: var(--color-background);
      }
      &:focus-visible {
        outline: 2px solid var(--color-primary);
      }
    }
    .tree__leaf {
      min-width: 2rem;
      text-align: center;
      color: var(--color-text-muted);
    }
    .tree__name {
      font-size: 0.9375rem;
    }
    .tree__count {
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }
    .tree__actions {
      display: inline-flex;
      gap: 0.375rem;
      flex-wrap: wrap;
      margin-left: auto;
    }
    .tree__danger {
      color: var(--color-danger);
    }
    .tree__input {
      flex: 1;
      min-width: 8rem;
      min-height: 36px;
      padding: 0 0.5rem;
      font-size: 0.9375rem;
      font-family: inherit;
      color: var(--color-text);
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: 0.375rem;

      &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
      }
    }
    .tree__input--min {
      flex: 0 0 5rem;
      min-width: 5rem;
    }
    .tree__add {
      all: unset;
      cursor: pointer;
      color: var(--color-primary);
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0.375rem 0.5rem;
      border-radius: 0.375rem;
      min-height: 32px;
      display: inline-flex;
      align-items: center;

      &:hover {
        background: var(--color-background);
      }
      &:focus-visible {
        outline: 2px solid var(--color-primary);
      }
    }
  `,
})
export class PlanoTreeComponent {
  private readonly planosService = inject(PlanosService);

  readonly plano = input.required<PlanoTree>();
  readonly canEdit = input.required<boolean>();
  readonly changed = output<void>();

  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly editing = signal<EditingNode | null>(null);
  readonly editNome = signal('');
  readonly editDuracao = signal<number | null>(null);

  readonly adding = signal<AddingTarget | null>(null);
  readonly newNome = signal('');
  readonly newDuracao = signal<number | null>(null);

  private readonly expanded = signal<Set<string>>(new Set());

  isExpanded(kind: NodeKind, id: string): boolean {
    return this.expanded().has(`${kind}:${id}`);
  }

  toggleExpanded(kind: NodeKind, id: string): void {
    const next = new Set(this.expanded());
    const key = `${kind}:${id}`;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expanded.set(next);
  }

  isEditing(kind: NodeKind, id: string): boolean {
    const e = this.editing();
    return e !== null && e.kind === kind && e.id === id;
  }

  startEdit(kind: NodeKind, id: string, nome: string, duracaoEstimadaMin?: number | null): void {
    this.error.set(null);
    this.adding.set(null);
    this.editing.set({ kind, id });
    this.editNome.set(nome);
    this.editDuracao.set(duracaoEstimadaMin ?? null);
  }

  cancelEdit(): void {
    this.editing.set(null);
  }

  saveEdit(): void {
    const editing = this.editing();
    const nome = this.editNome().trim();
    if (!editing || !nome) return;

    let request: Observable<unknown>;
    if (editing.kind === 'disciplina') {
      request = this.planosService.updateDisciplina(editing.id, { nome });
    } else if (editing.kind === 'tema') {
      request = this.planosService.updateTema(editing.id, { nome });
    } else {
      const duracao = this.editDuracao();
      request = this.planosService.updateSubtema(editing.id, {
        nome,
        duracaoEstimadaMin: duracao && duracao > 0 ? Math.round(duracao) : null,
      });
    }
    this.run(request, () => this.editing.set(null));
  }

  isAdding(kind: AddingTarget['kind'], parentId?: string): boolean {
    const a = this.adding();
    if (!a || a.kind !== kind) return false;
    if (a.kind === 'tema') return a.disciplinaId === parentId;
    if (a.kind === 'subtema') return a.temaId === parentId;
    return true;
  }

  startAdd(target: AddingTarget): void {
    this.error.set(null);
    this.editing.set(null);
    this.adding.set(target);
    this.newNome.set('');
    this.newDuracao.set(null);
    if (target.kind === 'tema') this.ensureExpanded('disciplina', target.disciplinaId);
    if (target.kind === 'subtema') this.ensureExpanded('tema', target.temaId);
  }

  cancelAdd(): void {
    this.adding.set(null);
  }

  saveAdd(): void {
    const adding = this.adding();
    const nome = this.newNome().trim();
    if (!adding || !nome) return;

    let request: Observable<unknown>;
    if (adding.kind === 'disciplina') {
      request = this.planosService.createDisciplina(this.plano().id, {
        nome,
        ordem: nextOrdem(this.plano().disciplinas),
      });
    } else if (adding.kind === 'tema') {
      const disciplina = this.plano().disciplinas.find((d) => d.id === adding.disciplinaId);
      request = this.planosService.createTema(adding.disciplinaId, {
        nome,
        ordem: nextOrdem(disciplina?.temas ?? []),
      });
    } else {
      const tema = this.plano()
        .disciplinas.flatMap((d) => d.temas)
        .find((t) => t.id === adding.temaId);
      const duracao = this.newDuracao();
      request = this.planosService.createSubtema(adding.temaId, {
        nome,
        ordem: nextOrdem(tema?.subtemas ?? []),
        duracaoEstimadaMin: duracao && duracao > 0 ? Math.round(duracao) : undefined,
      });
    }
    this.run(request, () => this.adding.set(null));
  }

  removeDisciplina(disciplina: DisciplinaTree): void {
    if (
      !confirm(
        `Remover a disciplina "${disciplina.nome}"? Temas, subtemas e o peso associado também serão removidos.`,
      )
    ) {
      return;
    }
    this.run(this.planosService.deleteDisciplina(disciplina.id));
  }

  removeTema(tema: TemaTree): void {
    if (!confirm(`Remover o tema "${tema.nome}" e seus subtemas?`)) return;
    this.run(this.planosService.deleteTema(tema.id));
  }

  removeSubtema(subtema: Subtema): void {
    if (!confirm(`Remover o subtema "${subtema.nome}"?`)) return;
    this.run(this.planosService.deleteSubtema(subtema.id));
  }

  moveDisciplina(index: number, delta: -1 | 1): void {
    this.move(this.plano().disciplinas, index, delta, (id, ordem) =>
      this.planosService.updateDisciplina(id, { ordem }),
    );
  }

  moveTema(disciplina: DisciplinaTree, index: number, delta: -1 | 1): void {
    this.move(disciplina.temas, index, delta, (id, ordem) =>
      this.planosService.updateTema(id, { ordem }),
    );
  }

  moveSubtema(tema: TemaTree, index: number, delta: -1 | 1): void {
    this.move(tema.subtemas, index, delta, (id, ordem) =>
      this.planosService.updateSubtema(id, { ordem }),
    );
  }

  /**
   * Sobe/desce um item trocando as ordens. Se as ordens estiverem duplicadas
   * (swap seria no-op), reindexa a lista inteira (0..n-1) já com a troca de
   * posição aplicada, destravando dados legados/importados.
   */
  private move(
    items: readonly { id: string; ordem: number }[],
    index: number,
    delta: -1 | 1,
    update: (id: string, ordem: number) => Observable<unknown>,
  ): void {
    const a = items[index];
    const b = items[index + delta];
    if (!a || !b) return;

    if (a.ordem !== b.ordem) {
      this.run(forkJoin([update(a.id, b.ordem), update(b.id, a.ordem)]));
      return;
    }

    const reordered = [...items];
    reordered[index] = b;
    reordered[index + delta] = a;
    this.run(forkJoin(reordered.map((item, i) => update(item.id, i))));
  }

  private ensureExpanded(kind: NodeKind, id: string): void {
    const key = `${kind}:${id}`;
    if (!this.expanded().has(key)) {
      const next = new Set(this.expanded());
      next.add(key);
      this.expanded.set(next);
    }
  }

  private run(request: Observable<unknown>, onSuccess?: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        onSuccess?.();
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const apiError = extractApiError(err);
        this.error.set(
          apiError.code === 'FORBIDDEN'
            ? 'Você não tem permissão para editar este plano.'
            : apiError.message,
        );
      },
    });
  }
}

function nextOrdem(items: { ordem: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.ordem), 0) + 1;
}

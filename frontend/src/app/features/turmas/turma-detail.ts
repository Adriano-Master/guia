import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';
import { TurmaAlunos } from './turma-alunos';
import { TurmaPlanosPanel } from './turma-planos-panel';
import type { Turma } from './turmas.models';
import { TurmasService } from './turmas.service';

@Component({
  selector: 'app-turma-detail',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, TurmaAlunos, TurmaPlanosPanel],
  template: `
    <section class="turma">
      <a class="turma__back" routerLink="/turmas">← Voltar às turmas</a>

      @if (loading()) {
        <p class="turma__state">Carregando turma…</p>
      } @else if (loadError()) {
        <div class="turma__state">
          <p class="alert alert--error" role="alert">{{ loadError() }}</p>
          <button class="btn btn--outline" type="button" (click)="load()">Tentar novamente</button>
        </div>
      } @else if (turma(); as t) {
        <header class="card turma__header">
          <div class="turma__badges">
            <span class="badge" [class.badge--ativo]="t.ativa" [class.badge--inativo]="!t.ativa">
              {{ t.ativa ? 'Ativa' : 'Inativa' }}
            </span>
          </div>

          @if (editing()) {
            @if (editError()) {
              <p class="alert alert--error" role="alert">{{ editError() }}</p>
            }
            <form [formGroup]="editForm" (ngSubmit)="saveEdit()" novalidate>
              <div class="field" [class.field--invalid]="editErrorFor('nome')">
                <label for="nome">Nome</label>
                <input id="nome" type="text" formControlName="nome" />
                @if (editErrorFor('nome'); as msg) {
                  <span class="field__error">{{ msg }}</span>
                }
              </div>
              <div class="field" [class.field--invalid]="editErrorFor('descricao')">
                <label for="descricao">Descrição</label>
                <textarea id="descricao" rows="3" formControlName="descricao"></textarea>
                @if (editErrorFor('descricao'); as msg) {
                  <span class="field__error">{{ msg }}</span>
                }
              </div>
              <div class="turma__actions">
                <button class="btn btn--primary" type="submit" [disabled]="savingEdit()">
                  {{ savingEdit() ? 'Salvando…' : 'Salvar' }}
                </button>
                <button
                  class="btn btn--outline"
                  type="button"
                  [disabled]="savingEdit()"
                  (click)="cancelEdit()"
                >
                  Cancelar
                </button>
              </div>
            </form>
          } @else {
            <h1 class="turma__title">{{ t.nome }}</h1>
            @if (t.descricao) {
              <p class="turma__desc">{{ t.descricao }}</p>
            }
            <p class="turma__meta">
              Criada em {{ t.createdAt | date: 'dd/MM/yyyy' }} · atualizada em
              {{ t.updatedAt | date: 'dd/MM/yyyy HH:mm' }}
            </p>

            @if (actionError()) {
              <p class="alert alert--error" role="alert">{{ actionError() }}</p>
            }

            <div class="turma__actions">
              <button class="btn btn--outline" type="button" (click)="startEdit()">
                Editar dados
              </button>
              <button
                class="btn btn--outline"
                [class.turma__desativar]="t.ativa"
                type="button"
                [disabled]="togglingAtiva()"
                (click)="toggleAtiva()"
              >
                {{
                  togglingAtiva()
                    ? 'Salvando…'
                    : t.ativa
                      ? 'Desativar turma'
                      : 'Reativar turma'
                }}
              </button>
            </div>
          }
        </header>

        @if (t.codigoConvite; as codigo) {
          <div class="card turma__convite">
            <h2>Código de convite</h2>
            <p class="turma__convite-hint">
              Compartilhe este código com os alunos para que entrem na turma.
              @if (!t.ativa) {
                <strong>Turma inativa: novas matrículas estão bloqueadas.</strong>
              }
            </p>

            @if (codigoError()) {
              <p class="alert alert--error" role="alert">{{ codigoError() }}</p>
            }

            <div class="turma__convite-row">
              <code class="turma__codigo" aria-label="Código de convite">{{ codigo }}</code>
              <button class="btn btn--outline" type="button" (click)="copiarCodigo()">
                {{ copiado() ? 'Copiado!' : 'Copiar código' }}
              </button>
              <button
                class="btn btn--outline"
                type="button"
                [disabled]="regenerando()"
                (click)="regenerarCodigo()"
              >
                {{ regenerando() ? 'Gerando…' : 'Regenerar código' }}
              </button>
            </div>
            <p class="turma__convite-aviso" aria-live="polite">
              @if (codigoRegenerado()) {
                Novo código gerado — o anterior deixou de funcionar.
              } @else {
                Regenerar invalida o código atual; matrículas já feitas permanecem.
              }
            </p>
          </div>
        }

        <app-turma-alunos [turmaId]="t.id" />
        <app-turma-planos-panel [turmaId]="t.id" />
      }
    </section>
  `,
  styles: `
    .turma {
      display: grid;
      gap: 1rem;
      max-width: 60rem;
      margin: 0 auto;
    }
    .turma__back {
      font-size: 0.875rem;
      text-decoration: none;

      &:hover,
      &:focus-visible {
        text-decoration: underline;
      }
    }
    .turma__state {
      display: grid;
      gap: 0.75rem;
      justify-items: center;
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
    }
    .turma__header {
      display: grid;
      gap: 0.5rem;
    }
    .turma__badges {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }
    .turma__title {
      margin: 0;
      font-size: 1.5rem;
    }
    .turma__desc {
      margin: 0;
      color: var(--color-text-muted);
    }
    .turma__meta {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    .turma__actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }
    .turma__desativar {
      color: var(--color-danger);
      border-color: var(--color-danger);
    }
    .turma__convite {
      display: grid;
      gap: 0.625rem;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
    .turma__convite-hint {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;

      strong {
        color: var(--color-danger);
      }
    }
    .turma__convite-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .turma__codigo {
      padding: 0.5rem 1rem;
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: var(--color-primary);
      background: var(--color-background);
      border: 1px dashed var(--color-border);
      border-radius: 0.5rem;
      user-select: all;
    }
    .turma__convite-aviso {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    textarea {
      padding: 0.625rem 0.75rem;
      font-size: 1rem;
      font-family: inherit;
      color: var(--color-text);
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: 0.5rem;
      resize: vertical;

      &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
        border-color: var(--color-primary);
      }
    }
  `,
})
export default class TurmaDetail {
  private readonly turmasService = inject(TurmasService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);

  private readonly id = signal('');

  readonly turma = signal<Turma | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly editing = signal(false);
  readonly savingEdit = signal(false);
  readonly editError = signal<string | null>(null);

  readonly togglingAtiva = signal(false);
  readonly actionError = signal<string | null>(null);

  readonly copiado = signal(false);
  readonly regenerando = signal(false);
  readonly codigoRegenerado = signal(false);
  readonly codigoError = signal<string | null>(null);

  readonly editForm = this.fb.group({
    nome: ['', [Validators.required, Validators.maxLength(200)]],
    descricao: ['', [Validators.maxLength(2000)]],
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.id.set(params.get('id') ?? '');
      this.editing.set(false);
      this.actionError.set(null);
      this.codigoError.set(null);
      this.codigoRegenerado.set(false);
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.turmasService.get(this.id()).subscribe({
      next: (turma) => {
        this.turma.set(turma);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        this.loadError.set(
          apiError.code === 'FORBIDDEN'
            ? 'Você não tem permissão para gerenciar esta turma.'
            : apiError.message,
        );
      },
    });
  }

  editErrorFor(field: string): string | null {
    return fieldErrorMessage(this.editForm.get(field));
  }

  startEdit(): void {
    const t = this.turma();
    if (!t) return;
    this.editError.set(null);
    this.editForm.setValue({ nome: t.nome, descricao: t.descricao ?? '' });
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  saveEdit(): void {
    this.editForm.markAllAsTouched();
    if (this.editForm.invalid) return;
    const t = this.turma();
    if (!t) return;

    const { nome, descricao } = this.editForm.getRawValue();
    this.savingEdit.set(true);
    this.editError.set(null);
    this.turmasService.update(t.id, { nome: nome.trim(), descricao: descricao.trim() }).subscribe({
      next: (updated) => {
        this.savingEdit.set(false);
        this.editing.set(false);
        this.turma.set({ ...t, ...updated });
      },
      error: (err: unknown) => {
        this.savingEdit.set(false);
        const apiError = extractApiError(err);
        const unmatched = applyFieldErrors(this.editForm, apiError);
        if (apiError.code === 'FORBIDDEN') {
          this.editError.set('Você não tem permissão para editar esta turma.');
        } else if (!apiError.details?.length || unmatched.length > 0) {
          this.editError.set(apiError.message);
        }
      },
    });
  }

  /** RN-05: desativar bloqueia novas matrículas, mantendo as existentes. */
  toggleAtiva(): void {
    const t = this.turma();
    if (!t) return;
    if (
      t.ativa &&
      !confirm(`Desativar a turma "${t.nome}"? Novas matrículas ficam bloqueadas.`)
    ) {
      return;
    }

    this.togglingAtiva.set(true);
    this.actionError.set(null);
    this.turmasService.update(t.id, { ativa: !t.ativa }).subscribe({
      next: (updated) => {
        this.togglingAtiva.set(false);
        this.turma.set({ ...t, ...updated });
      },
      error: (err: unknown) => {
        this.togglingAtiva.set(false);
        this.actionError.set(extractApiError(err).message);
      },
    });
  }

  async copiarCodigo(): Promise<void> {
    const codigo = this.turma()?.codigoConvite;
    if (!codigo) return;
    this.codigoError.set(null);
    try {
      await navigator.clipboard.writeText(codigo);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    } catch {
      this.codigoError.set('Não foi possível copiar. Selecione o código e copie manualmente.');
    }
  }

  regenerarCodigo(): void {
    const t = this.turma();
    if (!t) return;
    if (
      !confirm(
        'Regenerar o código de convite? O código atual deixa de funcionar para novas matrículas.',
      )
    ) {
      return;
    }

    this.regenerando.set(true);
    this.codigoError.set(null);
    this.codigoRegenerado.set(false);
    this.turmasService.regenerarCodigo(t.id).subscribe({
      next: (codigoConvite) => {
        this.regenerando.set(false);
        this.codigoRegenerado.set(true);
        this.turma.set({ ...t, codigoConvite });
      },
      error: (err: unknown) => {
        this.regenerando.set(false);
        this.codigoError.set(extractApiError(err).message);
      },
    });
  }
}

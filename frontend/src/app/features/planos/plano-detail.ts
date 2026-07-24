import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { applyFieldErrors, extractApiError, type ApiErrorDetail } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';
import { PlanoPesosComponent } from './plano-pesos';
import { PlanoTreeComponent } from './plano-tree';
import type { PlanoTree } from './planos.models';
import { PlanosService } from './planos.service';

@Component({
  selector: 'app-plano-detail',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, PlanoTreeComponent, PlanoPesosComponent],
  template: `
    <section class="plano">
      <a class="plano__back" routerLink="/planos">← Voltar aos planos</a>

      @if (loading()) {
        <p class="plano__state">Carregando plano…</p>
      } @else if (loadError()) {
        <div class="plano__state">
          <p class="alert alert--error" role="alert">{{ loadError() }}</p>
          <button class="btn btn--outline" type="button" (click)="load()">Tentar novamente</button>
        </div>
      } @else if (plano(); as p) {
        <header class="card plano__header">
          <div class="plano__badges">
            <span
              class="badge"
              [class.badge--oficial]="p.tipo === 'OFICIAL'"
              [class.badge--pessoal]="p.tipo === 'PESSOAL'"
            >
              {{ p.tipo }}
            </span>
            @if (p.tipo === 'OFICIAL') {
              <span class="badge" [class.badge--ativo]="p.publicado">
                {{ p.publicado ? 'Publicado' : 'Rascunho' }}
              </span>
            }
            @if (!canEdit()) {
              <span class="badge">Somente leitura</span>
            }
          </div>

          @if (editingHeader()) {
            @if (headerError()) {
              <p class="alert alert--error" role="alert">{{ headerError() }}</p>
            }
            <form [formGroup]="headerForm" (ngSubmit)="saveHeader()" novalidate>
              <div class="field" [class.field--invalid]="headerErrorFor('titulo')">
                <label for="titulo">Título</label>
                <input id="titulo" type="text" formControlName="titulo" />
                @if (headerErrorFor('titulo'); as msg) {
                  <span class="field__error">{{ msg }}</span>
                }
              </div>
              <div class="field" [class.field--invalid]="headerErrorFor('descricao')">
                <label for="descricao">Descrição</label>
                <textarea id="descricao" rows="3" formControlName="descricao"></textarea>
                @if (headerErrorFor('descricao'); as msg) {
                  <span class="field__error">{{ msg }}</span>
                }
              </div>
              <div class="plano__header-actions">
                <button class="btn btn--primary" type="submit" [disabled]="savingHeader()">
                  {{ savingHeader() ? 'Salvando…' : 'Salvar' }}
                </button>
                <button
                  class="btn btn--outline"
                  type="button"
                  [disabled]="savingHeader()"
                  (click)="cancelHeaderEdit()"
                >
                  Cancelar
                </button>
              </div>
            </form>
          } @else {
            <h1 class="plano__title">{{ p.titulo }}</h1>
            @if (p.descricao) {
              <p class="plano__desc">{{ p.descricao }}</p>
            }
            <p class="plano__meta">
              Criado em {{ p.createdAt | date: 'dd/MM/yyyy' }} · atualizado em
              {{ p.updatedAt | date: 'dd/MM/yyyy HH:mm' }}
            </p>

            @if (actionError()) {
              <p class="alert alert--error" role="alert">{{ actionError() }}</p>
            }
            @if (publishDetails().length > 0) {
              <ul class="alert alert--error plano__details" role="alert">
                @for (detail of publishDetails(); track $index) {
                  <li>{{ detail.field }}: {{ detail.issue }}</li>
                }
              </ul>
            }
            @if (actionSuccess()) {
              <p class="alert alert--success" role="status">{{ actionSuccess() }}</p>
            }

            <div class="plano__header-actions">
              @if (canEdit()) {
                <button class="btn btn--outline" type="button" (click)="startHeaderEdit()">
                  Editar dados
                </button>
              }
              @if (canPublish()) {
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="acting()"
                  (click)="publicar()"
                >
                  {{ acting() ? 'Publicando…' : 'Publicar' }}
                </button>
              }
              @if (canDerive()) {
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="acting()"
                  (click)="derivar()"
                >
                  {{ acting() ? 'Copiando…' : 'Criar meu plano a partir deste' }}
                </button>
              }
              @if (canEdit()) {
                <button
                  class="btn btn--outline plano__delete"
                  type="button"
                  [disabled]="acting()"
                  (click)="excluir()"
                >
                  Excluir plano
                </button>
              }
            </div>
          }
        </header>

        <app-plano-tree [plano]="p" [canEdit]="canEdit()" (changed)="reload()" />
        <app-plano-pesos [plano]="p" [canEdit]="canEdit()" (changed)="reload()" />
      }
    </section>
  `,
  styles: `
    .plano {
      display: grid;
      gap: 1rem;
      max-width: 60rem;
      margin: 0 auto;
    }
    .plano__back {
      font-size: 0.875rem;
      text-decoration: none;

      &:hover,
      &:focus-visible {
        text-decoration: underline;
      }
    }
    .plano__state {
      display: grid;
      gap: 0.75rem;
      justify-items: center;
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
    }
    .plano__header {
      display: grid;
      gap: 0.5rem;
    }
    .plano__badges {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }
    .plano__title {
      margin: 0;
      font-size: 1.5rem;
    }
    .plano__desc {
      margin: 0;
      color: var(--color-text-muted);
    }
    .plano__meta {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    .plano__details {
      margin: 0;
      padding-left: 2rem;
    }
    .plano__header-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }
    .plano__delete {
      color: var(--color-danger);
      border-color: var(--color-danger);
      margin-left: auto;
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
    .badge--oficial {
      background: var(--color-primary);
      color: var(--color-primary-contrast);
      border-color: transparent;
    }
    .badge--pessoal {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
  `,
})
export default class PlanoDetail {
  private readonly planosService = inject(PlanosService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);

  private readonly id = signal('');

  readonly plano = signal<PlanoTree | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly editingHeader = signal(false);
  readonly savingHeader = signal(false);
  readonly headerError = signal<string | null>(null);

  readonly acting = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly actionSuccess = signal<string | null>(null);
  readonly publishDetails = signal<ApiErrorDetail[]>([]);

  readonly isAluno = computed(() => this.auth.role() === 'ALUNO');
  readonly isInterno = computed(() => {
    const role = this.auth.role();
    return role !== null && role !== 'ALUNO';
  });

  /** RN-06: OFICIAL editável por interno; PESSOAL apenas pelo autor. */
  readonly canEdit = computed(() => {
    const p = this.plano();
    const user = this.auth.currentUser();
    if (!p || !user) return false;
    if (p.tipo === 'OFICIAL') return this.isInterno();
    return p.autorId === user.id;
  });

  readonly canPublish = computed(() => {
    const p = this.plano();
    return !!p && p.tipo === 'OFICIAL' && !p.publicado && this.isInterno();
  });

  readonly canDerive = computed(() => {
    const p = this.plano();
    return !!p && p.tipo === 'OFICIAL' && p.publicado && this.isAluno();
  });

  readonly headerForm = this.fb.group({
    titulo: ['', [Validators.required, Validators.maxLength(200)]],
    descricao: ['', [Validators.maxLength(2000)]],
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.id.set(params.get('id') ?? '');
      this.editingHeader.set(false);
      this.actionError.set(null);
      this.actionSuccess.set(null);
      this.publishDetails.set([]);
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.fetch();
  }

  /** Recarrega a árvore sem esconder a página (após mutações dos editores). */
  reload(): void {
    this.fetch();
  }

  private fetch(): void {
    this.planosService.get(this.id()).subscribe({
      next: (plano) => {
        this.plano.set(plano);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        this.loadError.set(
          apiError.code === 'FORBIDDEN'
            ? 'Você não tem permissão para visualizar este plano.'
            : apiError.message,
        );
      },
    });
  }

  headerErrorFor(field: string): string | null {
    return fieldErrorMessage(this.headerForm.get(field));
  }

  startHeaderEdit(): void {
    const p = this.plano();
    if (!p) return;
    this.headerError.set(null);
    this.headerForm.setValue({ titulo: p.titulo, descricao: p.descricao ?? '' });
    this.editingHeader.set(true);
  }

  cancelHeaderEdit(): void {
    this.editingHeader.set(false);
  }

  saveHeader(): void {
    this.headerForm.markAllAsTouched();
    if (this.headerForm.invalid) return;
    const p = this.plano();
    if (!p) return;

    const { titulo, descricao } = this.headerForm.getRawValue();
    this.savingHeader.set(true);
    this.headerError.set(null);
    this.planosService
      .update(p.id, { titulo: titulo.trim(), descricao: descricao.trim() })
      .subscribe({
        next: (updated) => {
          this.savingHeader.set(false);
          this.editingHeader.set(false);
          this.plano.set({ ...p, ...updated });
        },
        error: (err: unknown) => {
          this.savingHeader.set(false);
          const apiError = extractApiError(err);
          const unmatched = applyFieldErrors(this.headerForm, apiError);
          if (apiError.code === 'FORBIDDEN') {
            this.headerError.set('Você não tem permissão para editar este plano.');
          } else if (!apiError.details?.length || unmatched.length > 0) {
            this.headerError.set(apiError.message);
          }
        },
      });
  }

  publicar(): void {
    const p = this.plano();
    if (!p) return;
    this.startAction();
    this.planosService.publicar(p.id).subscribe({
      next: (updated) => {
        this.acting.set(false);
        this.plano.set({ ...p, ...updated });
        this.actionSuccess.set('Plano publicado com sucesso.');
      },
      error: (err: unknown) => {
        this.acting.set(false);
        const apiError = extractApiError(err);
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
          this.actionError.set(apiError.message);
          this.publishDetails.set(apiError.details);
        } else if (apiError.code === 'FORBIDDEN') {
          this.actionError.set('Apenas usuários internos podem publicar um plano oficial.');
        } else {
          this.actionError.set(apiError.message);
        }
      },
    });
  }

  derivar(): void {
    const p = this.plano();
    if (!p) return;
    this.startAction();
    this.planosService.derivar(p.id).subscribe({
      next: (derivado) => {
        this.acting.set(false);
        void this.router.navigate(['/planos', derivado.id]);
      },
      error: (err: unknown) => {
        this.acting.set(false);
        const apiError = extractApiError(err);
        this.actionError.set(
          apiError.code === 'FORBIDDEN'
            ? 'Apenas alunos podem derivar um plano oficial.'
            : apiError.message,
        );
      },
    });
  }

  excluir(): void {
    const p = this.plano();
    if (!p) return;
    if (!confirm(`Excluir o plano "${p.titulo}"? Todo o conteúdo e pesos serão removidos.`)) return;
    this.startAction();
    this.planosService.delete(p.id).subscribe({
      next: () => {
        this.acting.set(false);
        void this.router.navigate(['/planos']);
      },
      error: (err: unknown) => {
        this.acting.set(false);
        const apiError = extractApiError(err);
        this.actionError.set(
          apiError.code === 'FORBIDDEN'
            ? 'Você não tem permissão para excluir este plano.'
            : apiError.message,
        );
      },
    });
  }

  private startAction(): void {
    this.acting.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.publishDetails.set([]);
  }
}

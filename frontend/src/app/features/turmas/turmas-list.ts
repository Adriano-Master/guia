import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormsModule,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import type { Paginated } from '../../core/auth/auth.models';
import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';
import type { Turma } from './turmas.models';
import { TurmasService } from './turmas.service';

const PAGE_SIZE = 12;

/** Área do professor: turmas próprias (ADMIN/MODERADOR veem todas). */
@Component({
  selector: 'app-turmas-list',
  imports: [DatePipe, FormsModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="turmas">
      <header class="turmas__header">
        <h1>Turmas</h1>
        <button class="btn btn--primary" type="button" (click)="toggleCreate()">
          {{ creating() ? 'Cancelar' : 'Nova turma' }}
        </button>
      </header>

      @if (creating()) {
        <div class="card turmas__create">
          <h2>Nova turma</h2>
          <p class="turmas__hint">
            A turma é criada ativa e com um código de convite único para compartilhar com os
            alunos.
          </p>
          @if (createError()) {
            <p class="alert alert--error" role="alert">{{ createError() }}</p>
          }
          <form [formGroup]="createForm" (ngSubmit)="create()" novalidate>
            <div class="field" [class.field--invalid]="createErrorFor('nome')">
              <label for="nome">Nome</label>
              <input id="nome" type="text" formControlName="nome" />
              @if (createErrorFor('nome'); as msg) {
                <span class="field__error">{{ msg }}</span>
              }
            </div>
            <div class="field" [class.field--invalid]="createErrorFor('descricao')">
              <label for="descricao">Descrição (opcional)</label>
              <textarea id="descricao" rows="3" formControlName="descricao"></textarea>
              @if (createErrorFor('descricao'); as msg) {
                <span class="field__error">{{ msg }}</span>
              }
            </div>
            <button class="btn btn--primary" type="submit" [disabled]="savingCreate()">
              {{ savingCreate() ? 'Criando…' : 'Criar turma' }}
            </button>
          </form>
        </div>
      }

      <div class="turmas__filters">
        <div class="field">
          <label for="ativa">Situação</label>
          <select id="ativa" [ngModel]="ativaFilter()" (ngModelChange)="setAtivaFilter($event)">
            <option value="">Todas</option>
            <option value="true">Ativas</option>
            <option value="false">Inativas</option>
          </select>
        </div>
        <div class="field">
          <label for="sort">Ordenar por</label>
          <select id="sort" [ngModel]="sort()" (ngModelChange)="setSort($event)">
            <option value="-createdAt">Mais recentes</option>
            <option value="createdAt">Mais antigas</option>
            <option value="nome">Nome (A–Z)</option>
            <option value="-nome">Nome (Z–A)</option>
          </select>
        </div>
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="turmas__state">Carregando turmas…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <div class="turmas__state">
            <p>Nenhuma turma encontrada.</p>
            @if (!creating()) {
              <button class="btn btn--outline" type="button" (click)="toggleCreate()">
                Criar minha primeira turma
              </button>
            }
          </div>
        } @else {
          <ul class="turmas__grid">
            @for (turma of res.data; track turma.id) {
              <li class="card card--flat turmas__item">
                <div class="turmas__badges">
                  <span
                    class="badge"
                    [class.badge--ativo]="turma.ativa"
                    [class.badge--inativo]="!turma.ativa"
                  >
                    {{ turma.ativa ? 'Ativa' : 'Inativa' }}
                  </span>
                </div>
                <h2 class="turmas__title">
                  <a [routerLink]="['/turmas', turma.id]">{{ turma.nome }}</a>
                </h2>
                @if (turma.descricao) {
                  <p class="turmas__desc">{{ turma.descricao }}</p>
                }
                <p class="turmas__meta">Criada em {{ turma.createdAt | date: 'dd/MM/yyyy' }}</p>
                <div class="turmas__actions">
                  <a class="btn btn--outline btn--sm" [routerLink]="['/turmas', turma.id]">
                    Gerenciar
                  </a>
                </div>
              </li>
            }
          </ul>

          <div class="turmas__pagination">
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              Anterior
            </button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ res.total }} turmas</span>
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
    .turmas {
      display: grid;
      gap: 1rem;
      max-width: 70rem;
      margin: 0 auto;
    }
    .turmas__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .turmas__create h2 {
      margin: 0 0 0.25rem;
      font-size: 1.125rem;
    }
    .turmas__hint {
      margin: 0 0 1rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
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
    .turmas__filters {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      .field {
        margin-bottom: 0;
      }

      @media (min-width: 640px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .turmas__state {
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
      display: grid;
      gap: 0.75rem;
      justify-items: center;
    }
    .turmas__grid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 1rem;
      grid-template-columns: 1fr;

      @media (min-width: 640px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (min-width: 1024px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .turmas__item {
      display: grid;
      gap: 0.5rem;
      align-content: start;
    }
    .turmas__badges {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }
    .turmas__title {
      margin: 0;
      font-size: 1.125rem;

      a {
        color: inherit;
        text-decoration: none;

        &:hover,
        &:focus-visible {
          text-decoration: underline;
        }
      }
    }
    .turmas__desc {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .turmas__meta {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    .turmas__actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }
    .turmas__pagination {
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
export default class TurmasList {
  private readonly turmasService = inject(TurmasService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly ativaFilter = signal<'' | 'true' | 'false'>('');
  readonly sort = signal('-createdAt');
  readonly page = signal(1);

  readonly result = signal<Paginated<Turma> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly creating = signal(false);
  readonly savingCreate = signal(false);
  readonly createError = signal<string | null>(null);

  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  readonly createForm = this.fb.group({
    nome: ['', [Validators.required, Validators.maxLength(200)]],
    descricao: ['', [Validators.maxLength(2000)]],
  });

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  constructor() {
    this.load();
  }

  load(): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.turmasService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        sort: this.sort(),
        ativa: this.ativaFilter() === '' ? undefined : this.ativaFilter() === 'true',
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

  setAtivaFilter(value: '' | 'true' | 'false'): void {
    this.ativaFilter.set(value);
    this.page.set(1);
    this.load();
  }

  setSort(value: string): void {
    this.sort.set(value);
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  toggleCreate(): void {
    this.creating.set(!this.creating());
    this.createError.set(null);
    if (this.creating()) this.createForm.reset();
  }

  createErrorFor(field: string): string | null {
    return fieldErrorMessage(this.createForm.get(field));
  }

  create(): void {
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid) return;

    const { nome, descricao } = this.createForm.getRawValue();
    this.savingCreate.set(true);
    this.createError.set(null);
    this.turmasService
      .create({ nome: nome.trim(), descricao: descricao.trim() || undefined })
      .subscribe({
        next: (turma) => {
          this.savingCreate.set(false);
          void this.router.navigate(['/turmas', turma.id]);
        },
        error: (err: unknown) => {
          this.savingCreate.set(false);
          const apiError = extractApiError(err);
          const unmatched = applyFieldErrors(this.createForm, apiError);
          if (apiError.code === 'FORBIDDEN') {
            this.createError.set('Você não tem permissão para criar turmas.');
          } else if (!apiError.details?.length || unmatched.length > 0) {
            this.createError.set(apiError.message);
          }
        },
      });
  }
}

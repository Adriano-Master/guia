import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import type { Paginated } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';
import type { Plano, PlanoTipo } from './planos.models';
import { PlanosService } from './planos.service';

const PAGE_SIZE = 12;

@Component({
  selector: 'app-planos-list',
  imports: [DatePipe, FormsModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="planos">
      <header class="planos__header">
        <h1>Planos de estudo</h1>
        <button class="btn btn--primary" type="button" (click)="toggleCreate()">
          {{ creating() ? 'Cancelar' : 'Novo plano' }}
        </button>
      </header>

      @if (creating()) {
        <div class="card planos__create">
          <h2>Novo plano {{ isInterno() ? 'OFICIAL' : 'PESSOAL' }}</h2>
          <p class="planos__hint">
            {{
              isInterno()
                ? 'Como usuário interno, o plano será criado como OFICIAL (não publicado).'
                : 'O plano será criado como PESSOAL, visível apenas para você.'
            }}
          </p>
          @if (createError()) {
            <p class="alert alert--error" role="alert">{{ createError() }}</p>
          }
          <form [formGroup]="createForm" (ngSubmit)="create()" novalidate>
            <div class="field" [class.field--invalid]="createErrorFor('titulo')">
              <label for="titulo">Título</label>
              <input id="titulo" type="text" formControlName="titulo" />
              @if (createErrorFor('titulo'); as msg) {
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
              {{ savingCreate() ? 'Criando…' : 'Criar plano' }}
            </button>
          </form>
        </div>
      }

      <div class="planos__filters">
        <div class="field">
          <label for="tipo">Tipo</label>
          <select id="tipo" [ngModel]="tipoFilter()" (ngModelChange)="setTipoFilter($event)">
            <option value="">Todos</option>
            <option value="OFICIAL">OFICIAL</option>
            <option value="PESSOAL">PESSOAL</option>
          </select>
        </div>
        @if (isInterno()) {
          <div class="field">
            <label for="publicado">Publicação</label>
            <select
              id="publicado"
              [ngModel]="publicadoFilter()"
              (ngModelChange)="setPublicadoFilter($event)"
            >
              <option value="">Todos</option>
              <option value="true">Publicados</option>
              <option value="false">Não publicados</option>
            </select>
          </div>
        }
        <div class="field">
          <label for="sort">Ordenar por</label>
          <select id="sort" [ngModel]="sort()" (ngModelChange)="setSort($event)">
            <option value="-createdAt">Mais recentes</option>
            <option value="createdAt">Mais antigos</option>
            <option value="titulo">Título (A–Z)</option>
            <option value="-titulo">Título (Z–A)</option>
          </select>
        </div>
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="planos__state">Carregando planos…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <div class="planos__state">
            <p>Nenhum plano encontrado.</p>
            @if (!creating()) {
              <button class="btn btn--outline" type="button" (click)="toggleCreate()">
                Criar meu primeiro plano
              </button>
            }
          </div>
        } @else {
          <ul class="planos__grid">
            @for (plano of res.data; track plano.id) {
              <li class="card card--flat planos__item">
                <div class="planos__badges">
                  <span
                    class="badge"
                    [class.badge--oficial]="plano.tipo === 'OFICIAL'"
                    [class.badge--pessoal]="plano.tipo === 'PESSOAL'"
                  >
                    {{ plano.tipo }}
                  </span>
                  @if (plano.tipo === 'OFICIAL') {
                    <span class="badge" [class.badge--ativo]="plano.publicado">
                      {{ plano.publicado ? 'Publicado' : 'Rascunho' }}
                    </span>
                  }
                </div>
                <h2 class="planos__title">
                  <a [routerLink]="['/planos', plano.id]">{{ plano.titulo }}</a>
                </h2>
                @if (plano.descricao) {
                  <p class="planos__desc">{{ plano.descricao }}</p>
                }
                <p class="planos__meta">Criado em {{ plano.createdAt | date: 'dd/MM/yyyy' }}</p>
                <div class="planos__actions">
                  <a class="btn btn--outline btn--sm" [routerLink]="['/planos', plano.id]">Abrir</a>
                  @if (isAluno() && plano.tipo === 'OFICIAL' && plano.publicado) {
                    <button
                      class="btn btn--primary btn--sm"
                      type="button"
                      [disabled]="derivandoId() === plano.id"
                      (click)="derivar(plano)"
                    >
                      {{
                        derivandoId() === plano.id ? 'Copiando…' : 'Criar meu plano a partir deste'
                      }}
                    </button>
                  }
                </div>
              </li>
            }
          </ul>

          <div class="planos__pagination">
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              Anterior
            </button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ res.total }} planos</span>
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
    .planos {
      display: grid;
      gap: 1rem;
      max-width: 70rem;
      margin: 0 auto;
    }
    .planos__header {
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
    .planos__create h2 {
      margin: 0 0 0.25rem;
      font-size: 1.125rem;
    }
    .planos__hint {
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
    .planos__filters {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      .field {
        margin-bottom: 0;
      }

      @media (min-width: 640px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .planos__state {
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
      display: grid;
      gap: 0.75rem;
      justify-items: center;
    }
    .planos__grid {
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
    .planos__item {
      display: grid;
      gap: 0.5rem;
      align-content: start;
    }
    .planos__badges {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }
    .planos__title {
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
    .planos__desc {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .planos__meta {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    .planos__actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }
    .planos__pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--color-text-muted);
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
export default class PlanosList {
  private readonly planosService = inject(PlanosService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly isAluno = computed(() => this.auth.role() === 'ALUNO');
  readonly isInterno = computed(() => {
    const role = this.auth.role();
    return role !== null && role !== 'ALUNO';
  });

  readonly tipoFilter = signal<'' | PlanoTipo>('');
  readonly publicadoFilter = signal<'' | 'true' | 'false'>('');
  readonly sort = signal('-createdAt');
  readonly page = signal(1);

  readonly result = signal<Paginated<Plano> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly creating = signal(false);
  readonly savingCreate = signal(false);
  readonly createError = signal<string | null>(null);
  readonly derivandoId = signal<string | null>(null);

  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  readonly createForm = this.fb.group({
    titulo: ['', [Validators.required, Validators.maxLength(200)]],
    descricao: ['', [Validators.maxLength(2000)]],
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.planosService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        sort: this.sort(),
        tipo: this.tipoFilter() || undefined,
        publicado: this.publicadoFilter() === '' ? undefined : this.publicadoFilter() === 'true',
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

  setTipoFilter(value: '' | PlanoTipo): void {
    this.tipoFilter.set(value);
    this.page.set(1);
    this.load();
  }

  setPublicadoFilter(value: '' | 'true' | 'false'): void {
    this.publicadoFilter.set(value);
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

    const { titulo, descricao } = this.createForm.getRawValue();
    this.savingCreate.set(true);
    this.createError.set(null);
    this.planosService
      .create({
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        tipo: this.isInterno() ? 'OFICIAL' : 'PESSOAL',
      })
      .subscribe({
        next: (plano) => {
          this.savingCreate.set(false);
          void this.router.navigate(['/planos', plano.id]);
        },
        error: (err: unknown) => {
          this.savingCreate.set(false);
          const apiError = extractApiError(err);
          const unmatched = applyFieldErrors(this.createForm, apiError);
          if (apiError.code === 'FORBIDDEN') {
            this.createError.set('Você não tem permissão para criar este tipo de plano.');
          } else if (!apiError.details?.length || unmatched.length > 0) {
            this.createError.set(apiError.message);
          }
        },
      });
  }

  derivar(plano: Plano): void {
    this.error.set(null);
    this.derivandoId.set(plano.id);
    this.planosService.derivar(plano.id).subscribe({
      next: (derivado) => {
        this.derivandoId.set(null);
        void this.router.navigate(['/planos', derivado.id]);
      },
      error: (err: unknown) => {
        this.derivandoId.set(null);
        const apiError = extractApiError(err);
        this.error.set(
          apiError.code === 'FORBIDDEN'
            ? 'Apenas alunos podem derivar um plano oficial.'
            : apiError.message,
        );
      },
    });
  }
}

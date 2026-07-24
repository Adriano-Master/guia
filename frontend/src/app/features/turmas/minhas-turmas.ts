import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import type { Paginated } from '../../core/auth/auth.models';
import { extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';
import { MatriculasService } from './matriculas.service';
import { TurmaPlanosService } from './turma-planos.service';
import type { Matricula, TurmaPlano } from './turmas.models';

const PAGE_SIZE = 10;

/** Área do aluno: entrar em turma por código e acompanhar as turmas ativas. */
@Component({
  selector: 'app-minhas-turmas',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="mturmas">
      <h1>Minhas turmas</h1>

      <div class="card mturmas__entrar">
        <h2>Entrar em uma turma</h2>
        <p class="mturmas__hint">
          Informe o código de convite de 8 caracteres fornecido pelo professor.
        </p>

        @if (joinError()) {
          <p class="alert alert--error" role="alert">{{ joinError() }}</p>
        }
        @if (joinSuccess()) {
          <p class="alert alert--success" role="status">{{ joinSuccess() }}</p>
        }

        <form class="mturmas__form" (submit)="matricular($event)" novalidate>
          <div class="field mturmas__codigo-field" [class.field--invalid]="codigoErrorMsg()">
            <label for="codigo">Código de convite</label>
            <input
              id="codigo"
              class="mturmas__codigo-input"
              type="text"
              [formControl]="codigoControl"
              (input)="onCodigoInput()"
              maxlength="8"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              placeholder="ABCD2345"
            />
            @if (codigoErrorMsg(); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>
          <button class="btn btn--primary" type="submit" [disabled]="joining()">
            {{ joining() ? 'Entrando…' : 'Entrar na turma' }}
          </button>
        </form>
      </div>

      @if (listError()) {
        <p class="alert alert--error" role="alert">{{ listError() }}</p>
      }

      @if (loading()) {
        <p class="mturmas__state">Carregando suas turmas…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <p class="mturmas__state">
            Você ainda não participa de nenhuma turma. Use um código de convite para entrar.
          </p>
        } @else {
          <ul class="mturmas__lista">
            @for (matricula of res.data; track matricula.id) {
              <li class="card card--flat mturmas__item">
                <div class="mturmas__item-header">
                  <div class="mturmas__item-info">
                    <h2 class="mturmas__item-titulo">{{ matricula.turma?.nome ?? 'Turma' }}</h2>
                    @if (matricula.turma?.descricao) {
                      <p class="mturmas__item-desc">{{ matricula.turma?.descricao }}</p>
                    }
                    @if (matricula.turma && !matricula.turma.ativa) {
                      <span class="badge badge--inativo">Turma inativa</span>
                    }
                  </div>
                  <div class="mturmas__item-actions">
                    <button
                      class="btn btn--outline btn--sm"
                      type="button"
                      [attr.aria-expanded]="expandedId() === matricula.turmaId"
                      [attr.aria-controls]="
                        expandedId() === matricula.turmaId
                          ? 'mturmas-planos-' + matricula.turmaId
                          : null
                      "
                      (click)="togglePlanos(matricula.turmaId)"
                    >
                      {{ expandedId() === matricula.turmaId ? 'Ocultar planos' : 'Ver planos' }}
                    </button>
                    <button
                      class="btn btn--outline btn--sm mturmas__sair"
                      type="button"
                      [disabled]="saindoId() === matricula.id"
                      [attr.aria-label]="'Sair da turma ' + (matricula.turma?.nome ?? '')"
                      (click)="sair(matricula)"
                    >
                      {{ saindoId() === matricula.id ? 'Saindo…' : 'Sair da turma' }}
                    </button>
                  </div>
                </div>

                @if (expandedId() === matricula.turmaId) {
                  <div class="mturmas__planos" [id]="'mturmas-planos-' + matricula.turmaId">
                    <h3>Planos oficiais da turma</h3>
                    @if (planosLoading()) {
                      <p class="mturmas__planos-state">Carregando planos…</p>
                    } @else if (planosError()) {
                      <p class="alert alert--error" role="alert">{{ planosError() }}</p>
                    } @else if (planos().length === 0) {
                      <p class="mturmas__planos-state">
                        Esta turma ainda não tem planos vinculados.
                      </p>
                    } @else {
                      <ul class="mturmas__planos-lista">
                        @for (vinculo of planos(); track vinculo.id) {
                          <li>
                            <a class="mturmas__plano-link" [routerLink]="['/planos', vinculo.planoId]">
                              {{ vinculo.plano?.titulo ?? 'Plano' }}
                            </a>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                }
              </li>
            }
          </ul>

          @if (totalPages() > 1) {
            <div class="mturmas__pagination">
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
      }
    </section>
  `,
  styles: `
    .mturmas {
      display: grid;
      gap: 1rem;
      max-width: 48rem;
      margin: 0 auto;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .mturmas__entrar {
      display: grid;
      gap: 0.625rem;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
    .mturmas__hint {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .mturmas__form {
      display: flex;
      align-items: end;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .mturmas__codigo-field {
      flex: 1;
      min-width: 12rem;
      margin-bottom: 0;
    }
    .mturmas__codigo-input {
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 600;
    }
    .mturmas__state {
      margin: 0;
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
    }
    .mturmas__lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.75rem;
    }
    .mturmas__item {
      display: grid;
      gap: 0.75rem;
    }
    .mturmas__item-header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .mturmas__item-info {
      display: grid;
      gap: 0.375rem;
      min-width: 0;

      .badge {
        justify-self: start;
      }
    }
    .mturmas__item-titulo {
      margin: 0;
      font-size: 1.125rem;
      overflow-wrap: anywhere;
    }
    .mturmas__item-desc {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .mturmas__item-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .mturmas__sair {
      color: var(--color-danger);
      border-color: var(--color-danger);
    }
    .mturmas__planos {
      display: grid;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--color-border);

      h3 {
        margin: 0;
        font-size: 0.9375rem;
      }
    }
    .mturmas__planos-state {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .mturmas__planos-lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
    }
    .mturmas__plano-link {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      font-weight: 500;
      text-decoration: none;

      &:hover,
      &:focus-visible {
        text-decoration: underline;
      }
    }
    .mturmas__pagination {
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
export default class MinhasTurmas {
  private readonly matriculasService = inject(MatriculasService);
  private readonly turmaPlanosService = inject(TurmaPlanosService);

  readonly codigoControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(8)],
  });

  readonly joining = signal(false);
  readonly joinError = signal<string | null>(null);
  readonly joinSuccess = signal<string | null>(null);

  readonly page = signal(1);
  readonly result = signal<Paginated<Matricula> | null>(null);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly saindoId = signal<string | null>(null);

  readonly expandedId = signal<string | null>(null);
  readonly planos = signal<TurmaPlano[]>([]);
  readonly planosLoading = signal(false);
  readonly planosError = signal<string | null>(null);

  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  constructor() {
    this.load();
  }

  /** Só as matrículas ATIVAS: sair da turma remove o item da lista. */
  load(): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.listError.set(null);
    this.matriculasService
      .listMe({ page: this.page(), pageSize: PAGE_SIZE, sort: '-createdAt', status: 'ATIVA' })
      .subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          if (seq !== this.loadSeq) return;
          this.loading.set(false);
          this.listError.set(extractApiError(err).message);
        },
      });
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.expandedId.set(null);
    this.load();
  }

  codigoErrorMsg(): string | null {
    return fieldErrorMessage(this.codigoControl);
  }

  /** Uppercase automático: o código não tem letras minúsculas. */
  onCodigoInput(): void {
    const value = this.codigoControl.value;
    const upper = value.toUpperCase();
    if (value !== upper) this.codigoControl.setValue(upper);
  }

  matricular(event: Event): void {
    event.preventDefault();
    this.codigoControl.markAsTouched();
    if (this.codigoControl.invalid || this.joining()) return;

    this.joining.set(true);
    this.joinError.set(null);
    this.joinSuccess.set(null);
    // 201 (nova) e 200 (reativada) são o mesmo sucesso para o aluno
    this.matriculasService.matricular(this.codigoControl.value.trim()).subscribe({
      next: (matricula) => {
        this.joining.set(false);
        this.codigoControl.reset();
        const nome = matricula.turma?.nome;
        this.joinSuccess.set(nome ? `Você entrou na turma "${nome}".` : 'Você entrou na turma.');
        this.page.set(1);
        this.load();
      },
      error: (err: unknown) => {
        this.joining.set(false);
        const apiError = extractApiError(err);
        // 404 (código inválido) e 409 (já matriculado / turma inativa) chegam
        // com mensagem amigável no envelope
        this.joinError.set(
          apiError.code === 'NOT_FOUND' ? 'Código de convite inválido.' : apiError.message,
        );
      },
    });
  }

  togglePlanos(turmaId: string): void {
    if (this.expandedId() === turmaId) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(turmaId);
    this.planos.set([]);
    this.planosError.set(null);
    this.planosLoading.set(true);
    this.turmaPlanosService.list(turmaId, { page: 1, pageSize: 100 }).subscribe({
      next: (res) => {
        if (this.expandedId() !== turmaId) return;
        this.planosLoading.set(false);
        this.planos.set(res.data);
      },
      error: (err: unknown) => {
        if (this.expandedId() !== turmaId) return;
        this.planosLoading.set(false);
        this.planosError.set(extractApiError(err).message);
      },
    });
  }

  sair(matricula: Matricula): void {
    const nome = matricula.turma?.nome ?? 'esta turma';
    // turma inativa bloqueia novas matrículas (RN-05): rematrícula por código
    // falharia com 409, então a volta depende do professor
    const pergunta =
      matricula.turma?.ativa === false
        ? `Sair da turma "${nome}"? Esta turma está inativa: para voltar, o professor precisará reativar a turma ou readmitir você.`
        : `Sair da turma "${nome}"? Você pode voltar usando o código de convite.`;
    if (!confirm(pergunta)) return;

    this.listError.set(null);
    this.saindoId.set(matricula.id);
    this.matriculasService.updateStatus(matricula.id, 'INATIVA').subscribe({
      next: () => {
        this.saindoId.set(null);
        if (this.expandedId() === matricula.turmaId) this.expandedId.set(null);
        this.load();
      },
      error: (err: unknown) => {
        this.saindoId.set(null);
        this.listError.set(extractApiError(err).message);
      },
    });
  }
}

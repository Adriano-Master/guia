import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import type { Paginated } from '../../core/auth/auth.models';
import { extractApiError } from '../../core/http/api-error';
import { MatriculasService } from './matriculas.service';
import type { Matricula, MatriculaStatus } from './turmas.models';

const PAGE_SIZE = 10;

/** Alunos matriculados na turma (visão do professor dono/moderação). */
@Component({
  selector: 'app-turma-alunos',
  imports: [DatePipe, FormsModule],
  template: `
    <section class="card alunos" aria-labelledby="alunos-titulo">
      <header class="alunos__header">
        <h2 id="alunos-titulo">Alunos matriculados</h2>
        <div class="field alunos__filtro">
          <label for="alunos-status">Status</label>
          <select
            id="alunos-status"
            [ngModel]="statusFilter()"
            (ngModelChange)="setStatusFilter($event)"
          >
            <option value="">Todos</option>
            <option value="ATIVA">Ativas</option>
            <option value="INATIVA">Inativas</option>
          </select>
        </div>
      </header>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="alunos__state">Carregando alunos…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <p class="alunos__state">
            {{
              statusFilter()
                ? 'Nenhuma matrícula com este status.'
                : 'Nenhum aluno matriculado ainda. Compartilhe o código de convite da turma.'
            }}
          </p>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Matrícula em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (matricula of res.data; track matricula.id) {
                  <tr>
                    <td>{{ matricula.aluno?.nome ?? '—' }}</td>
                    <td>{{ matricula.aluno?.email ?? '—' }}</td>
                    <td>
                      <span
                        class="badge"
                        [class.badge--ativo]="matricula.status === 'ATIVA'"
                        [class.badge--inativo]="matricula.status === 'INATIVA'"
                      >
                        {{ matricula.status }}
                      </span>
                    </td>
                    <td>{{ matricula.createdAt | date: 'dd/MM/yyyy' }}</td>
                    <td>
                      <button
                        class="btn btn--outline btn--sm"
                        type="button"
                        [disabled]="mutatingId() === matricula.id"
                        [attr.aria-label]="
                          (matricula.status === 'ATIVA' ? 'Inativar matrícula de ' : 'Reativar matrícula de ') +
                          (matricula.aluno?.nome ?? 'aluno')
                        "
                        (click)="toggleStatus(matricula)"
                      >
                        {{
                          mutatingId() === matricula.id
                            ? 'Salvando…'
                            : matricula.status === 'ATIVA'
                              ? 'Inativar'
                              : 'Reativar'
                        }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="alunos__pagination">
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              Anterior
            </button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ res.total }} matrículas</span>
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
    .alunos {
      display: grid;
      gap: 1rem;
    }
    .alunos__header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
    .alunos__filtro {
      margin-bottom: 0;
      min-width: 10rem;
    }
    .alunos__state {
      margin: 0;
      color: var(--color-text-muted);
      text-align: center;
      padding: 1.5rem 0;
    }
    .alunos__pagination {
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
export class TurmaAlunos {
  private readonly matriculasService = inject(MatriculasService);

  readonly turmaId = input.required<string>();

  readonly statusFilter = signal<'' | MatriculaStatus>('');
  readonly page = signal(1);

  readonly result = signal<Paginated<Matricula> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly mutatingId = signal<string | null>(null);

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  constructor() {
    // turmaId é input required (indisponível no constructor); o effect carrega
    // quando o input resolve e recarrega se a turma mudar
    effect(() => {
      this.turmaId();
      untracked(() => {
        this.page.set(1);
        this.load();
      });
    });
  }

  load(): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.matriculasService
      .listByTurma(this.turmaId(), {
        page: this.page(),
        pageSize: PAGE_SIZE,
        sort: '-createdAt',
        status: this.statusFilter() || undefined,
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

  setStatusFilter(value: '' | MatriculaStatus): void {
    this.statusFilter.set(value);
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  toggleStatus(matricula: Matricula): void {
    const inativar = matricula.status === 'ATIVA';
    const nome = matricula.aluno?.nome ?? 'este aluno';
    const pergunta = inativar
      ? `Inativar a matrícula de ${nome}? O aluno deixa de acessar a turma.`
      : `Reativar a matrícula de ${nome}?`;
    if (!confirm(pergunta)) return;

    this.error.set(null);
    this.mutatingId.set(matricula.id);
    this.matriculasService.updateStatus(matricula.id, inativar ? 'INATIVA' : 'ATIVA').subscribe({
      next: () => {
        this.mutatingId.set(null);
        // recarrega em vez de editar a linha: com filtro de status ativo a
        // matrícula pode sair da página atual
        this.load();
      },
      error: (err: unknown) => {
        this.mutatingId.set(null);
        this.error.set(extractApiError(err).message);
      },
    });
  }
}

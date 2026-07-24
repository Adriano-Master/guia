import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import type { Paginated, Role, User, UserStatus } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { UsersService } from '../../core/auth/users.service';
import { extractApiError } from '../../core/http/api-error';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-usuarios',
  imports: [DatePipe, FormsModule, ReactiveFormsModule],
  template: `
    <section class="admin">
      <h1>Usuários</h1>

      <div class="admin__filters">
        <div class="field">
          <label for="q">Buscar</label>
          <input id="q" type="search" [formControl]="searchControl" placeholder="Nome ou email" />
        </div>
        <div class="field">
          <label for="role">Role</label>
          <select id="role" [ngModel]="roleFilter()" (ngModelChange)="setRoleFilter($event)">
            <option value="">Todas</option>
            @for (r of roles; track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="status">Status</label>
          <select id="status" [ngModel]="statusFilter()" (ngModelChange)="setStatusFilter($event)">
            <option value="">Todos</option>
            @for (s of statuses; track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
        </div>
      </div>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }
      @if (saved()) {
        <p class="alert alert--success" role="status">Usuário atualizado com sucesso.</p>
      }

      @if (loading()) {
        <p class="admin__state">Carregando usuários…</p>
      } @else if (result(); as res) {
        @if (res.data.length === 0) {
          <p class="admin__state">Nenhum usuário encontrado com os filtros atuais.</p>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>
                    <button class="admin__sort" type="button" (click)="toggleSort('nome')">
                      Nome {{ sortIndicator('nome') }}
                    </button>
                  </th>
                  <th>
                    <button class="admin__sort" type="button" (click)="toggleSort('email')">
                      Email {{ sortIndicator('email') }}
                    </button>
                  </th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Origem</th>
                  <th>
                    <button class="admin__sort" type="button" (click)="toggleSort('ultimoLoginAt')">
                      Último login {{ sortIndicator('ultimoLoginAt') }}
                    </button>
                  </th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (user of res.data; track user.id) {
                  <tr>
                    <td>
                      {{ user.nome }}
                      @if (user.id === currentUserId()) {
                        <span class="badge">você</span>
                      }
                    </td>
                    <td>{{ user.email }}</td>
                    @if (editingId() === user.id) {
                      <td>
                        <select
                          [ngModel]="editRole()"
                          (ngModelChange)="editRole.set($event)"
                          aria-label="Role"
                        >
                          @for (r of roles; track r) {
                            <option [value]="r">{{ r }}</option>
                          }
                        </select>
                      </td>
                      <td>
                        <select
                          [ngModel]="editStatus()"
                          (ngModelChange)="editStatus.set($event)"
                          aria-label="Status"
                        >
                          @for (s of statuses; track s) {
                            <option [value]="s">{{ s }}</option>
                          }
                        </select>
                      </td>
                    } @else {
                      <td>{{ user.role }}</td>
                      <td>
                        <span
                          class="badge"
                          [class.badge--ativo]="user.status === 'ATIVO'"
                          [class.badge--inativo]="user.status === 'INATIVO'"
                        >
                          {{ user.status }}
                        </span>
                      </td>
                    }
                    <td>{{ user.origem }}</td>
                    <td>
                      {{
                        user.ultimoLoginAt ? (user.ultimoLoginAt | date: 'dd/MM/yyyy HH:mm') : '—'
                      }}
                    </td>
                    <td>
                      @if (editingId() === user.id) {
                        <button
                          class="btn btn--primary btn--sm"
                          type="button"
                          [disabled]="saving()"
                          (click)="saveEdit(user)"
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
                      } @else {
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          (click)="startEdit(user)"
                        >
                          Editar
                        </button>
                        @if (user.role === 'ALUNO') {
                          <button
                            class="btn btn--outline btn--sm"
                            type="button"
                            [disabled]="impersonatingId() !== null"
                            [attr.aria-label]="'Ver como aluno: ' + user.nome"
                            (click)="verComoAluno(user)"
                          >
                            <svg class="admin__eye" viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"
                              />
                              <circle cx="12" cy="12" r="2.8" />
                            </svg>
                            {{ impersonatingId() === user.id ? 'Abrindo…' : 'Ver como aluno' }}
                          </button>
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (editingSelf()) {
            <p class="admin__warning" role="alert">
              Atenção: você está editando a própria conta. Rebaixar sua role ou desativar seu status
              pode remover seu próprio acesso administrativo.
            </p>
          }

          <div class="admin__pagination">
            <button
              class="btn btn--outline btn--sm"
              type="button"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              Anterior
            </button>
            <span>Página {{ page() }} de {{ totalPages() }} · {{ res.total }} usuários</span>
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
    .admin {
      display: grid;
      gap: 1rem;
      max-width: 70rem;
      margin: 0 auto;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
    }
    .admin__filters {
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
    .admin__state {
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
    }
    .admin__sort {
      all: unset;
      cursor: pointer;
      font: inherit;
      color: inherit;

      &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
    }
    .admin__warning {
      margin: 0;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      background: var(--color-danger-bg);
      color: var(--color-danger);
      font-size: 0.875rem;
    }
    .admin__pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }
    td .btn + .btn {
      margin-left: 0.5rem;
    }
    .admin__eye {
      width: 16px;
      height: 16px;
      vertical-align: -3px;
      margin-right: 0.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    td select {
      min-height: 36px;
      border: 1px solid var(--color-border);
      border-radius: 0.375rem;
      background: var(--color-background);
      color: var(--color-text);
      font-family: inherit;
    }
  `,
})
export default class AdminUsuarios {
  private readonly usersService = inject(UsersService);
  private readonly auth = inject(AuthService);
  private readonly impersonation = inject(ImpersonationService);

  readonly roles: Role[] = ['ADMIN', 'MODERADOR', 'PROFESSOR', 'ALUNO'];
  readonly statuses: UserStatus[] = ['ATIVO', 'INATIVO', 'PENDENTE'];

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly roleFilter = signal<'' | Role>('');
  readonly statusFilter = signal<'' | UserStatus>('');
  readonly sort = signal('nome');
  readonly page = signal(1);

  readonly result = signal<Paginated<User> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);

  readonly editingId = signal<string | null>(null);
  readonly editRole = signal<Role>('ALUNO');
  readonly editStatus = signal<UserStatus>('ATIVO');
  readonly saving = signal(false);
  readonly impersonatingId = signal<string | null>(null);

  readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  readonly editingSelf = computed(
    () => this.editingId() !== null && this.editingId() === this.currentUserId(),
  );
  readonly totalPages = computed(() => {
    const res = this.result();
    return res ? Math.max(1, Math.ceil(res.total / res.pageSize)) : 1;
  });

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.usersService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        sort: this.sort(),
        role: this.roleFilter() || undefined,
        status: this.statusFilter() || undefined,
        q: this.searchControl.value.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          const apiError = extractApiError(err);
          this.error.set(
            apiError.code === 'FORBIDDEN'
              ? 'Você não tem permissão para acessar a administração de usuários.'
              : apiError.message,
          );
        },
      });
  }

  setRoleFilter(value: '' | Role): void {
    this.roleFilter.set(value);
    this.page.set(1);
    this.load();
  }

  setStatusFilter(value: '' | UserStatus): void {
    this.statusFilter.set(value);
    this.page.set(1);
    this.load();
  }

  toggleSort(field: string): void {
    this.sort.set(this.sort() === field ? `-${field}` : field);
    this.page.set(1);
    this.load();
  }

  sortIndicator(field: string): string {
    if (this.sort() === field) return '▲';
    if (this.sort() === `-${field}`) return '▼';
    return '';
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  verComoAluno(user: User): void {
    this.error.set(null);
    this.saved.set(false);
    this.impersonatingId.set(user.id);
    this.impersonation.entrar(user).subscribe({
      next: () => this.impersonatingId.set(null),
      error: (err: unknown) => {
        this.impersonatingId.set(null);
        this.error.set(extractApiError(err).message);
      },
    });
  }

  startEdit(user: User): void {
    this.saved.set(false);
    this.error.set(null);
    this.editingId.set(user.id);
    this.editRole.set(user.role);
    this.editStatus.set(user.status);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(user: User): void {
    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);
    this.usersService
      .adminUpdate(user.id, { role: this.editRole(), status: this.editStatus() })
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.editingId.set(null);
          this.saved.set(true);
          const res = this.result();
          if (res) {
            this.result.set({
              ...res,
              data: res.data.map((u) => (u.id === updated.id ? updated : u)),
            });
          }
          if (updated.id === this.currentUserId()) {
            this.auth.setUser(updated);
          }
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const apiError = extractApiError(err);
          switch (apiError.code) {
            case 'CONFLICT':
              this.error.set(
                'Não é possível rebaixar ou desativar o último administrador ativo da plataforma.',
              );
              break;
            case 'FORBIDDEN':
              this.error.set('Você não tem permissão para alterar usuários.');
              break;
            default:
              this.error.set(apiError.message);
          }
        },
      });
  }
}

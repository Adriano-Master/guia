import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import type { Paginated, User } from '../../core/auth/auth.models';
import { UsersService } from '../../core/auth/users.service';
import { extractApiError } from '../../core/http/api-error';
import { PlanosService } from '../planos/planos.service';
import { TurmasService } from '../turmas/turmas.service';

const ROLE_LABELS: Record<User['role'], string> = {
  ADMIN: 'Admin',
  MODERADOR: 'Moderador',
  PROFESSOR: 'Professor',
  ALUNO: 'Aluno',
};

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe, RouterLink],
  template: `
    <section class="adash">
      <header class="adash__header">
        <h1>Dashboard</h1>
        <p class="adash__subtitle">Visão geral da plataforma.</p>
      </header>

      @if (loading()) {
        <p class="adash__state">Carregando visão geral…</p>
      } @else if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      } @else {
        <ul class="adash__tiles">
          <li class="card card--flat adash__tile">
            <span class="adash__tile-label">Usuários</span>
            <span class="adash__tile-value">{{ totalUsuarios() }}</span>
            <a class="adash__tile-link" routerLink="/admin/usuarios">Gerenciar usuários</a>
          </li>
          <li class="card card--flat adash__tile">
            <span class="adash__tile-label">Alunos</span>
            <span class="adash__tile-value">{{ totalAlunos() }}</span>
          </li>
          <li class="card card--flat adash__tile">
            <span class="adash__tile-label">Professores</span>
            <span class="adash__tile-value">{{ totalProfessores() }}</span>
          </li>
          <li class="card card--flat adash__tile">
            <span class="adash__tile-label">Turmas</span>
            <span class="adash__tile-value">{{ totalTurmas() }}</span>
            <a class="adash__tile-link" routerLink="/turmas">Ver turmas</a>
          </li>
          <li class="card card--flat adash__tile">
            <span class="adash__tile-label">Planos publicados</span>
            <span class="adash__tile-value">{{ totalPlanosPublicados() }}</span>
            <a class="adash__tile-link" routerLink="/planos">Ver planos</a>
          </li>
        </ul>

        <section class="card adash__panel" aria-labelledby="adash-recentes-titulo">
          <h2 id="adash-recentes-titulo" class="adash__panel-title">Últimos cadastros</h2>
          @if (recentes().length === 0) {
            <p class="adash__empty">Nenhum usuário cadastrado ainda.</p>
          } @else {
            <ul class="adash__recentes">
              @for (user of recentes(); track user.id) {
                <li class="adash__recente">
                  <div class="adash__recente-id">
                    <span class="adash__recente-nome">{{ user.nome }}</span>
                    <span class="adash__recente-email">{{ user.email }}</span>
                  </div>
                  <span class="badge">{{ roleLabel(user.role) }}</span>
                  <span
                    class="badge"
                    [class.badge--ativo]="user.status === 'ATIVO'"
                    [class.badge--inativo]="user.status === 'INATIVO'"
                  >
                    {{ user.status }}
                  </span>
                  <span class="adash__recente-data">{{ user.createdAt | date: 'dd/MM/yyyy' }}</span>
                </li>
              }
            </ul>
            <a class="btn btn--outline btn--sm adash__panel-cta" routerLink="/admin/usuarios">
              Ver todos os usuários
            </a>
          }
        </section>
      }
    </section>
  `,
  styles: `
    .adash {
      display: grid;
      gap: 1.5rem;
      max-width: 64rem;
      margin: 0 auto;
    }

    .adash__header {
      display: grid;
      gap: 0.25rem;
    }

    .adash__header h1 {
      margin: 0;
      font-size: 1.5rem;
    }

    .adash__subtitle {
      margin: 0;
      color: var(--text-secondary);
    }

    .adash__state {
      margin: 0;
      padding: 2rem 0;
      text-align: center;
      color: var(--text-secondary);
    }

    .adash__tiles {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: 1rem;
    }

    .adash__tile {
      display: grid;
      gap: 0.25rem;
      align-content: start;
    }

    .adash__tile-label {
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .adash__tile-value {
      font-size: 1.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .adash__tile-link {
      font-size: 0.85rem;
      color: var(--accent);
    }

    .adash__panel {
      display: grid;
      gap: 1rem;
    }

    .adash__panel-title {
      margin: 0;
      font-size: 1.1rem;
    }

    .adash__empty {
      margin: 0;
      color: var(--text-secondary);
    }

    .adash__recentes {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }

    .adash__recente {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--glass-border);
      border-radius: 0.6rem;
      background: var(--surface-flat);
    }

    .adash__recente-id {
      flex: 1;
      min-width: 12rem;
      display: grid;
    }

    .adash__recente-nome {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .adash__recente-email {
      font-size: 0.85rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .adash__recente-data {
      font-size: 0.85rem;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
    }

    .adash__panel-cta {
      justify-self: start;
    }
  `,
})
export default class AdminDashboard {
  private readonly usersService = inject(UsersService);
  private readonly turmasService = inject(TurmasService);
  private readonly planosService = inject(PlanosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private readonly usuarios = signal<Paginated<User> | null>(null);
  readonly totalAlunos = signal(0);
  readonly totalProfessores = signal(0);
  readonly totalTurmas = signal(0);
  readonly totalPlanosPublicados = signal(0);

  readonly totalUsuarios = computed(() => this.usuarios()?.total ?? 0);
  readonly recentes = computed(() => this.usuarios()?.data ?? []);

  constructor() {
    // Contagens derivadas do `total` das listagens paginadas (pageSize mínimo):
    // não há endpoint agregado de métricas no backend.
    forkJoin({
      usuarios: this.usersService.list({ page: 1, pageSize: 5, sort: '-createdAt' }),
      alunos: this.usersService.list({ page: 1, pageSize: 1, role: 'ALUNO' }),
      professores: this.usersService.list({ page: 1, pageSize: 1, role: 'PROFESSOR' }),
      turmas: this.turmasService
        .list({ page: 1, pageSize: 1 })
        .pipe(catchError(() => of(null))),
      planos: this.planosService
        .list({ page: 1, pageSize: 1, publicado: true })
        .pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ usuarios, alunos, professores, turmas, planos }) => {
          this.usuarios.set(usuarios);
          this.totalAlunos.set(alunos.total);
          this.totalProfessores.set(professores.total);
          this.totalTurmas.set(turmas?.total ?? 0);
          this.totalPlanosPublicados.set(planos?.total ?? 0);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(extractApiError(err).message);
        },
      });
  }

  roleLabel(role: User['role']): string {
    return ROLE_LABELS[role];
  }
}

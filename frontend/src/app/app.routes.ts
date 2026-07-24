import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { Shell } from './shared/layout/shell';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./features/home/home') },
  { path: 'login', loadComponent: () => import('./features/auth/login') },
  { path: 'register', loadComponent: () => import('./features/auth/register') },
  { path: 'forgot-password', loadComponent: () => import('./features/auth/forgot-password') },
  { path: 'reset-password', loadComponent: () => import('./features/auth/reset-password') },
  {
    path: '',
    component: Shell,
    children: [
      {
        path: 'perfil',
        canActivate: [authGuard],
        loadComponent: () => import('./features/perfil/perfil'),
      },
      {
        path: 'planos',
        canActivate: [authGuard],
        loadChildren: () => import('./features/planos/planos.routes'),
      },
      {
        path: 'turmas',
        canActivate: [roleGuard('ADMIN', 'MODERADOR', 'PROFESSOR')],
        loadChildren: () => import('./features/turmas/turmas.routes'),
      },
      {
        path: 'minhas-turmas',
        canActivate: [roleGuard('ALUNO')],
        loadComponent: () => import('./features/turmas/minhas-turmas'),
      },
      {
        path: 'cronograma',
        canActivate: [roleGuard('ALUNO')],
        loadChildren: () => import('./features/cronograma/cronograma.routes'),
      },
      {
        path: 'sessoes',
        canActivate: [roleGuard('ALUNO')],
        loadChildren: () => import('./features/sessoes/sessoes.routes'),
      },
      {
        path: 'progresso',
        canActivate: [roleGuard('ALUNO')],
        loadComponent: () => import('./features/progresso/progresso-page'),
      },
      {
        path: 'questoes',
        canActivate: [roleGuard('ALUNO')],
        loadChildren: () => import('./features/questoes/questoes.routes'),
      },
      {
        path: 'estatisticas',
        canActivate: [roleGuard('ALUNO')],
        loadChildren: () => import('./features/estatisticas/estatisticas.routes'),
      },
      {
        path: 'ranking',
        canActivate: [roleGuard('ALUNO', 'PROFESSOR')],
        loadChildren: () => import('./features/gamificacao/gamificacao.routes'),
      },
      {
        path: 'admin/usuarios',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./features/admin-usuarios/admin-usuarios'),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

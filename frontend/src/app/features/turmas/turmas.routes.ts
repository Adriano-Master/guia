import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./turmas-list') },
  { path: ':id', loadComponent: () => import('./turma-detail') },
] satisfies Routes;

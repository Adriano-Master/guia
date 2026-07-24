import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./planos-list') },
  { path: ':id', loadComponent: () => import('./plano-detail') },
] satisfies Routes;

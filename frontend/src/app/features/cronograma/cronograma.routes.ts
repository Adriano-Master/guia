import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./calendario') },
  { path: 'configurar', loadComponent: () => import('./cronograma-config') },
] satisfies Routes;

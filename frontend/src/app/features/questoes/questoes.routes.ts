import { Routes } from '@angular/router';

export default [{ path: '', loadComponent: () => import('./questoes-page') }] satisfies Routes;

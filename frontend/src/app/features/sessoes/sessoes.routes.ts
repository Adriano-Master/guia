import { Routes } from '@angular/router';

export default [{ path: '', loadComponent: () => import('./sessoes-page') }] satisfies Routes;

import { Routes } from '@angular/router';

export default [{ path: '', loadComponent: () => import('./ranking-page') }] satisfies Routes;

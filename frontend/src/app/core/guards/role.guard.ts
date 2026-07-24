import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import type { Role } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';

/** Guard parametrizável por role. Não logado → /login; sem permissão → home. */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.hasValidSession()) {
      auth.clearSession();
      return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    }

    const role = auth.role();
    if (role && roles.includes(role)) return true;

    return router.createUrlTree(['/']);
  };
}

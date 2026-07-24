import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import type { HttpEvent } from '@angular/common/http';

import { AuthService } from '../auth/auth.service';
import { AVISO_IMPERSONACAO_EXPIRADA, ImpersonationService } from '../auth/impersonation.service';
import { TokenStorage } from '../auth/token-storage';

/** Marca requests já reenviadas após um refresh, para não tentar de novo. */
const REFRESH_RETRIED = new HttpContextToken<boolean>(() => false);

const PUBLIC_AUTH_PATHS = [
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Bearer só em chamadas relativas à nossa API — nunca vazar o token
  // (nem disparar refresh) para URLs absolutas/terceiros.
  if (!isApiRequest(req) || isPublicAuthRequest(req)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const tokens = inject(TokenStorage);
  const router = inject(Router);
  const impersonation = inject(ImpersonationService);

  const denySession = () => {
    auth.clearSession();
    auth.redirectToLogin(router.url);
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 401,
          url: req.url,
          error: {
            error: { code: 'UNAUTHENTICATED', message: 'Sessão expirada. Faça login novamente.' },
          },
        }),
    );
  };

  const send = (request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
    const accessToken = tokens.accessToken;
    const authed = accessToken
      ? request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } })
      : request;
    return next(authed).pipe(
      catchError((err: unknown) => {
        const is401 = err instanceof HttpErrorResponse && err.status === 401;
        if (!is401 || request.context.get(REFRESH_RETRIED)) {
          return throwError(() => err);
        }
        // Impersonação não tem refresh token: 401 = visualização expirou.
        // Restaura o admin (com aviso) em vez do fluxo de refresh/logout.
        if (impersonation.ativo()) {
          impersonation.sair(AVISO_IMPERSONACAO_EXPIRADA);
          return throwError(() => err);
        }
        request.context.set(REFRESH_RETRIED, true);
        return auth.refreshTokens().pipe(switchMap((ok) => (ok ? send(request) : denySession())));
      }),
    );
  };

  // Access sabidamente expirado: renova antes de enviar, evitando um 401 certo.
  if (tokens.accessToken && tokens.isAccessTokenExpired() && !tokens.isRefreshTokenExpired()) {
    req.context.set(REFRESH_RETRIED, true);
    return auth.refreshTokens().pipe(switchMap((ok) => (ok ? send(req) : denySession())));
  }

  return send(req);
};

function isApiRequest(req: HttpRequest<unknown>): boolean {
  return req.url.startsWith('/api/');
}

function isPublicAuthRequest(req: HttpRequest<unknown>): boolean {
  const path = req.url.split('?')[0];
  return PUBLIC_AUTH_PATHS.some((publicPath) => path.endsWith(publicPath));
}

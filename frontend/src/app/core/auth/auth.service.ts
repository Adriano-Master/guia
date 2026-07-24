import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';

import type { LoginResponse, RefreshResponse, Role, User, UserResponse } from './auth.models';
import { impersonationAvisoSignal, limparImpersonacao } from './impersonation-state';
import { TokenStorage } from './token-storage';

const API = '/api/v1/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tokens = inject(TokenStorage);

  private readonly userSignal = signal<User | null>(this.restoreUser());
  private refreshInFlight: Observable<boolean> | null = null;

  readonly currentUser = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.userSignal() !== null);
  readonly role = computed<Role | null>(() => this.userSignal()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'ADMIN');

  register(payload: { nome: string; email: string; senha: string }): Observable<User> {
    return this.http
      .post<UserResponse>(`${API}/register`, payload)
      .pipe(switchMap((res) => this.login(payload.email, payload.senha).pipe(map(() => res.user))));
  }

  login(email: string, senha: string): Observable<User> {
    return this.http.post<LoginResponse>(`${API}/login`, { email, senha }).pipe(
      tap((res) => {
        // sessão nova invalida qualquer backup/aviso órfão de impersonação
        limparImpersonacao();
        impersonationAvisoSignal.set(null);
        this.tokens.setTokens(res.accessToken, res.refreshToken);
        this.setUser(res.user);
      }),
      map((res) => res.user),
    );
  }

  logout(): void {
    const refreshToken = this.tokens.refreshToken;
    const finish = () => {
      this.clearSession();
      void this.router.navigate(['/login']);
    };
    if (refreshToken) {
      this.http
        .post(`${API}/logout`, { refreshToken })
        .pipe(catchError(() => of(null)))
        .subscribe(finish);
    } else {
      finish();
    }
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>(`${API}/forgot-password`, { email });
  }

  resetPassword(token: string, senhaNova: string): Observable<void> {
    return this.http.post<void>(`${API}/reset-password`, { token, senhaNova });
  }

  /**
   * Renova o par de tokens. Single-flight: chamadas concorrentes compartilham
   * a mesma requisição de refresh. Emite `true` se renovou, `false` se falhou
   * (nesse caso a sessão já foi limpa).
   */
  refreshTokens(): Observable<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const refreshToken = this.tokens.refreshToken;
    if (!refreshToken) {
      this.clearSession();
      return of(false);
    }

    this.refreshInFlight = this.http.post<RefreshResponse>(`${API}/refresh`, { refreshToken }).pipe(
      tap((res) => this.tokens.setTokens(res.accessToken, res.refreshToken)),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
      finalize(() => (this.refreshInFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshInFlight;
  }

  /** Sessão utilizável: access válido ou refresh ainda válido (interceptor renova). */
  hasValidSession(): boolean {
    return !this.tokens.isAccessTokenExpired() || !this.tokens.isRefreshTokenExpired();
  }

  setUser(user: User): void {
    this.tokens.setStoredUser(user);
    this.userSignal.set(user);
  }

  clearSession(): void {
    this.tokens.clear();
    limparImpersonacao();
    impersonationAvisoSignal.set(null);
    this.userSignal.set(null);
  }

  redirectToLogin(returnUrl?: string): void {
    void this.router.navigate(['/login'], {
      queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : undefined,
    });
  }

  private restoreUser(): User | null {
    if (this.tokens.isAccessTokenExpired() && this.tokens.isRefreshTokenExpired()) {
      this.tokens.clear();
      return null;
    }
    return this.tokens.getStoredUser();
  }
}

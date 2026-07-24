import { Injectable } from '@angular/core';

import type { User } from './auth.models';

const ACCESS_TOKEN_KEY = 'guia.accessToken';
const REFRESH_TOKEN_KEY = 'guia.refreshToken';
const USER_KEY = 'guia.user';

/** Margem de segurança para considerar um token expirado (evita usar token no limite). */
const EXP_SKEW_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class TokenStorage {
  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }

  /** Sessão só com access token (impersonação): remove qualquer refresh token. */
  setAccessTokenOnly(accessToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  getStoredUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }

  setStoredUser(user: User): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  isAccessTokenExpired(): boolean {
    const token = this.accessToken;
    if (!token) return true;
    const exp = decodeJwtExp(token);
    if (exp === null) return true;
    return Date.now() >= exp * 1000 - EXP_SKEW_MS;
  }

  isRefreshTokenExpired(): boolean {
    const token = this.refreshToken;
    if (!token) return true;
    const exp = decodeJwtExp(token);
    if (exp === null) return true;
    return Date.now() >= exp * 1000 - EXP_SKEW_MS;
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtExp(token: string): number | null {
  const exp = decodeJwtPayload(token)?.['exp'];
  return typeof exp === 'number' ? exp : null;
}

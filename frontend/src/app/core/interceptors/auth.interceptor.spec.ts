import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import type { Role, User } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';
import { AVISO_IMPERSONACAO_EXPIRADA, ImpersonationService } from '../auth/impersonation.service';
import { authInterceptor } from './auth.interceptor';

/**
 * Interceptor durante a impersonação: não há refresh token, então um 401
 * NÃO pode cair no fluxo normal de refresh/logout — restaura o admin
 * (ImpersonationService.sair com aviso). Fora da impersonação, o 401 segue
 * tentando o refresh normalmente (regressão).
 */

const ACCESS_KEY = 'guia.accessToken';
const REFRESH_KEY = 'guia.refreshToken';
const USER_KEY = 'guia.user';
const BACKUP_KEY = 'guia.impersonation-backup';
const STATE_KEY = 'guia.impersonation';

function buildJwt(expOffsetSeconds: number, claims: Record<string, unknown> = {}): string {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds, ...claims }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.sig`;
}

function buildUser(role: Role, id: string, nome: string): User {
  return {
    id,
    nome,
    email: `${id}@example.com`,
    role,
    status: 'ATIVO',
    origem: 'PROPRIO',
    ultimoLoginAt: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
  };
}

const admin = buildUser('ADMIN', 'admin-1', 'Ana Admin');
const aluno = buildUser('ALUNO', 'aluno-1', 'João Aluno');
const adminAccess = buildJwt(900);
const adminRefresh = buildJwt(86_400);
// token impersonado real carrega a claim impersonatedBy (contrato do backend)
const alunoAccess = buildJwt(900, { impersonatedBy: 'admin-1' });

function seedImpersonatedSession(): void {
  localStorage.setItem(ACCESS_KEY, alunoAccess);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.setItem(USER_KEY, JSON.stringify(aluno));
  localStorage.setItem(
    BACKUP_KEY,
    JSON.stringify({ accessToken: adminAccess, refreshToken: adminRefresh, user: admin }),
  );
  localStorage.setItem(STATE_KEY, JSON.stringify({ alunoNome: aluno.nome, adminNome: admin.nome }));
}

function setup(): {
  httpClient: HttpClient;
  http: HttpTestingController;
  navigate: ReturnType<typeof vi.fn>;
} {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', children: [] }]),
    ],
  });
  const navigate = vi.fn().mockResolvedValue(true);
  vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);
  return {
    httpClient: TestBed.inject(HttpClient),
    http: TestBed.inject(HttpTestingController),
    navigate,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('authInterceptor — 401 durante impersonação', () => {
  it('não tenta refresh: restaura o admin com aviso e propaga o erro', () => {
    seedImpersonatedSession();
    const { httpClient, http, navigate } = setup();
    const impersonation = TestBed.inject(ImpersonationService);
    const auth = TestBed.inject(AuthService);
    expect(impersonation.ativo()).toBe(true);

    const erros: HttpErrorResponse[] = [];
    httpClient.get('/api/v1/planos').subscribe({
      error: (err: HttpErrorResponse) => erros.push(err),
    });

    const req = http.expectOne('/api/v1/planos');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${alunoAccess}`);
    req.flush(
      { error: { code: 'UNAUTHENTICATED', message: 'Token expirado.' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    // nenhuma tentativa de refresh nem retry da request original
    http.verify();

    expect(erros).toHaveLength(1);
    expect(erros[0].status).toBe(401);
    expect(impersonation.ativo()).toBe(false);
    expect(impersonation.aviso()).toBe(AVISO_IMPERSONACAO_EXPIRADA);
    expect(localStorage.getItem(ACCESS_KEY)).toBe(adminAccess);
    expect(localStorage.getItem(REFRESH_KEY)).toBe(adminRefresh);
    expect(auth.currentUser()?.id).toBe('admin-1');
    expect(navigate).toHaveBeenCalledWith(['/admin/usuarios']);
    expect(navigate).not.toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('fora da impersonação, 401 segue o fluxo normal de refresh (regressão)', () => {
    localStorage.setItem(ACCESS_KEY, adminAccess);
    localStorage.setItem(REFRESH_KEY, adminRefresh);
    localStorage.setItem(USER_KEY, JSON.stringify(admin));
    const { httpClient, http } = setup();

    const respostas: unknown[] = [];
    httpClient.get('/api/v1/planos').subscribe((res) => respostas.push(res));

    http
      .expectOne('/api/v1/planos')
      .flush(
        { error: { code: 'UNAUTHENTICATED', message: 'Token expirado.' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    const novoAccess = buildJwt(900);
    const refreshReq = http.expectOne('/api/v1/auth/refresh');
    expect(refreshReq.request.body).toEqual({ refreshToken: adminRefresh });
    refreshReq.flush({ accessToken: novoAccess, refreshToken: buildJwt(86_400) });

    const retry = http.expectOne('/api/v1/planos');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${novoAccess}`);
    retry.flush({ data: [] });

    expect(respostas).toHaveLength(1);
    http.verify();
  });
});

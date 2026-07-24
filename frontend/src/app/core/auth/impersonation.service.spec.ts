import { provideHttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import type { Role, User } from './auth.models';
import { AuthService } from './auth.service';
import { AVISO_IMPERSONACAO_EXPIRADA, ImpersonationService } from './impersonation.service';

/**
 * Modo de visualização de aluno: entrar troca a sessão local pela do aluno
 * (sem refresh token) guardando backup do admin; sair restaura o admin;
 * o estado sobrevive a F5 e, com token do aluno expirado no boot, o admin
 * volta automaticamente com aviso. A reidratação só ativa se a sessão atual
 * é de fato a impersonada (claim `impersonatedBy`, sem refresh token) —
 * chaves órfãs nunca contaminam uma sessão real.
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

function buildUser(role: Role, overrides: Partial<User> = {}): User {
  return {
    id: role === 'ADMIN' ? 'admin-1' : 'aluno-1',
    nome: role === 'ADMIN' ? 'Ana Admin' : 'João Aluno',
    email: role === 'ADMIN' ? 'ana@example.com' : 'joao@example.com',
    role,
    status: 'ATIVO',
    origem: 'PROPRIO',
    ultimoLoginAt: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

const admin = buildUser('ADMIN');
const aluno = buildUser('ALUNO');
const adminAccess = buildJwt(900);
const adminRefresh = buildJwt(86_400);
// token impersonado real carrega a claim impersonatedBy (contrato do backend)
const alunoAccess = buildJwt(900, { impersonatedBy: 'admin-1' });

function seedAdminSession(): void {
  localStorage.setItem(ACCESS_KEY, adminAccess);
  localStorage.setItem(REFRESH_KEY, adminRefresh);
  localStorage.setItem(USER_KEY, JSON.stringify(admin));
}

function seedImpersonatedSession(alunoToken = alunoAccess): void {
  localStorage.setItem(ACCESS_KEY, alunoToken);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.setItem(USER_KEY, JSON.stringify({ ...aluno }));
  localStorage.setItem(
    BACKUP_KEY,
    JSON.stringify({ accessToken: adminAccess, refreshToken: adminRefresh, user: admin }),
  );
  localStorage.setItem(STATE_KEY, JSON.stringify({ alunoNome: aluno.nome, adminNome: admin.nome }));
}

interface Ctx {
  service: ImpersonationService;
  http: HttpTestingController;
  navigate: ReturnType<typeof vi.fn>;
  auth: AuthService;
}

function setup(): Ctx {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', children: [] }]),
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.fn().mockResolvedValue(true);
  vi.spyOn(router, 'navigate').mockImplementation(navigate);
  return {
    service: TestBed.inject(ImpersonationService),
    http: TestBed.inject(HttpTestingController),
    navigate,
    auth: TestBed.inject(AuthService),
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ImpersonationService — entrar', () => {
  it('POST /users/:id/impersonate, faz backup do admin, grava sessão do aluno sem refresh e navega para /', () => {
    seedAdminSession();
    const { service, http, navigate, auth } = setup();

    service.entrar(aluno).subscribe();
    const req = http.expectOne('/api/v1/users/aluno-1/impersonate');
    expect(req.request.method).toBe('POST');
    req.flush({
      accessToken: alunoAccess,
      user: { id: aluno.id, nome: aluno.nome, email: aluno.email, role: 'ALUNO' },
    });

    const backup = JSON.parse(localStorage.getItem(BACKUP_KEY)!) as {
      accessToken: string;
      refreshToken: string;
      user: User;
    };
    expect(backup.accessToken).toBe(adminAccess);
    expect(backup.refreshToken).toBe(adminRefresh);
    expect(backup.user.id).toBe('admin-1');

    expect(localStorage.getItem(ACCESS_KEY)).toBe(alunoAccess);
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(auth.currentUser()?.id).toBe('aluno-1');
    expect(auth.currentUser()?.role).toBe('ALUNO');

    expect(service.ativo()).toBe(true);
    expect(service.state()).toEqual({ alunoNome: 'João Aluno', adminNome: 'Ana Admin' });
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    http.verify();
  });

  it('erro da API (ex.: 422 alvo não-ALUNO) propaga e não altera a sessão do admin', () => {
    seedAdminSession();
    const { service, http, auth } = setup();
    const erros: unknown[] = [];

    service.entrar(aluno).subscribe({ error: (err: unknown) => erros.push(err) });
    http
      .expectOne('/api/v1/users/aluno-1/impersonate')
      .flush(
        { error: { code: 'VALIDATION_ERROR', message: 'Só é possível visualizar alunos.' } },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

    expect(erros).toHaveLength(1);
    expect((erros[0] as HttpErrorResponse).status).toBe(422);
    expect(service.ativo()).toBe(false);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(ACCESS_KEY)).toBe(adminAccess);
    expect(auth.currentUser()?.role).toBe('ADMIN');
    http.verify();
  });
});

describe('ImpersonationService — sair', () => {
  it('restaura tokens e user do admin, limpa backup/estado e navega para /admin/usuarios', () => {
    seedImpersonatedSession();
    const { service, navigate, auth } = setup();
    expect(service.ativo()).toBe(true);

    service.sair();

    expect(service.ativo()).toBe(false);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    expect(localStorage.getItem(ACCESS_KEY)).toBe(adminAccess);
    expect(localStorage.getItem(REFRESH_KEY)).toBe(adminRefresh);
    expect(auth.currentUser()?.id).toBe('admin-1');
    expect(navigate).toHaveBeenCalledWith(['/admin/usuarios']);
    expect(service.aviso()).toBeNull();
  });

  it('sair com aviso mantém a mensagem para o shell exibir; limparAviso a remove', () => {
    seedImpersonatedSession();
    const { service } = setup();

    service.sair(AVISO_IMPERSONACAO_EXPIRADA);
    expect(service.aviso()).toBe(AVISO_IMPERSONACAO_EXPIRADA);

    service.limparAviso();
    expect(service.aviso()).toBeNull();
  });

  it('sem backup utilizável, encerra a sessão, manda para o login e NÃO retém o aviso', () => {
    seedImpersonatedSession();
    localStorage.removeItem(BACKUP_KEY);
    localStorage.setItem(STATE_KEY, JSON.stringify({ alunoNome: 'x', adminNome: 'y' }));
    const { service, navigate, auth } = setup();

    service.sair(AVISO_IMPERSONACAO_EXPIRADA);

    expect(auth.currentUser()).toBeNull();
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.anything());
    // aviso não pode vazar para o próximo login de outra pessoa
    expect(service.aviso()).toBeNull();
  });

  it('entrar com sessão local incompleta (sem refresh do admin) propaga erro no envelope e não grava backup', () => {
    localStorage.setItem(ACCESS_KEY, adminAccess);
    localStorage.setItem(USER_KEY, JSON.stringify(admin));
    // sem refresh token: backup não seria restaurável
    const { service, http } = setup();
    const erros: unknown[] = [];

    service.entrar(aluno).subscribe({ error: (err: unknown) => erros.push(err) });
    http.expectOne('/api/v1/users/aluno-1/impersonate').flush({
      accessToken: alunoAccess,
      user: { id: aluno.id, nome: aluno.nome, email: aluno.email, role: 'ALUNO' },
    });

    expect(erros).toHaveLength(1);
    const erro = erros[0] as HttpErrorResponse;
    expect((erro.error as { error: { message: string } }).error.message).toContain(
      'sessão de admin não está íntegra',
    );
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(service.ativo()).toBe(false);
  });
});

describe('ImpersonationService — reidratação (F5)', () => {
  it('com token do aluno válido, restaura o estado de impersonação do localStorage', () => {
    seedImpersonatedSession();
    const { service, auth } = setup();

    expect(service.ativo()).toBe(true);
    expect(service.state()).toEqual({ alunoNome: 'João Aluno', adminNome: 'Ana Admin' });
    expect(auth.currentUser()?.role).toBe('ALUNO');
  });

  it('com token do aluno expirado (sem refresh), volta ao admin já no boot com aviso', () => {
    seedImpersonatedSession(buildJwt(-60, { impersonatedBy: 'admin-1' }));
    const { service, auth } = setup();

    expect(service.ativo()).toBe(false);
    expect(service.aviso()).toBe(AVISO_IMPERSONACAO_EXPIRADA);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    expect(localStorage.getItem(ACCESS_KEY)).toBe(adminAccess);
    expect(localStorage.getItem(REFRESH_KEY)).toBe(adminRefresh);
    expect(auth.currentUser()?.id).toBe('admin-1');
  });

  it('estado órfão (flag sem backup) é descartado sem ativar impersonação', () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ alunoNome: 'x', adminNome: 'y' }));
    const { service } = setup();

    expect(service.ativo()).toBe(false);
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
  });

  it('chaves órfãs sobre uma sessão real (com refresh e sem claim) são descartadas sem ativar nem tocar na sessão', () => {
    const outro = buildUser('ALUNO', { id: 'outro-1', nome: 'Outra Pessoa' });
    const outroAccess = buildJwt(900);
    const outroRefresh = buildJwt(86_400);
    localStorage.setItem(ACCESS_KEY, outroAccess);
    localStorage.setItem(REFRESH_KEY, outroRefresh);
    localStorage.setItem(USER_KEY, JSON.stringify(outro));
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ accessToken: adminAccess, refreshToken: adminRefresh, user: admin }),
    );
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ alunoNome: aluno.nome, adminNome: admin.nome }),
    );

    const { service, auth } = setup();

    expect(service.ativo()).toBe(false);
    expect(service.aviso()).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    // sessão real intocada — nunca substituída pelos tokens do backup
    expect(localStorage.getItem(ACCESS_KEY)).toBe(outroAccess);
    expect(localStorage.getItem(REFRESH_KEY)).toBe(outroRefresh);
    expect(auth.currentUser()?.id).toBe('outro-1');
  });

  it('token atual válido sem a claim impersonatedBy (e sem refresh) não ativa e descarta as chaves', () => {
    seedImpersonatedSession(buildJwt(900));
    const { service, auth } = setup();

    expect(service.ativo()).toBe(false);
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    // sessão atual permanece como está (não é substituída pelo backup)
    expect(auth.currentUser()?.id).toBe('aluno-1');
  });
});

describe('ImpersonationService — higiene da sessão (login/clearSession)', () => {
  it('login() limpa chaves órfãs de impersonação deixadas por uma sessão anterior', () => {
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ accessToken: adminAccess, refreshToken: adminRefresh, user: admin }),
    );
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ alunoNome: aluno.nome, adminNome: admin.nome }),
    );
    // ImpersonationService NÃO é construído (cenário: usuário foi direto ao /login)
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);

    auth.login('outra@example.com', 'senha').subscribe();
    http.expectOne('/api/v1/auth/login').flush({
      accessToken: buildJwt(900),
      refreshToken: buildJwt(86_400),
      user: buildUser('ALUNO', { id: 'outro-1' }),
    });

    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    expect(auth.currentUser()?.id).toBe('outro-1');
    http.verify();
  });

  it('clearSession() limpa chaves de impersonação e o aviso retido', () => {
    seedImpersonatedSession(buildJwt(-60, { impersonatedBy: 'admin-1' }));
    const { service, auth } = setup();
    expect(service.aviso()).toBe(AVISO_IMPERSONACAO_EXPIRADA);

    auth.clearSession();

    expect(service.aviso()).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    expect(auth.currentUser()).toBeNull();
  });
});

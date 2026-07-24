# Auth e Usuários — Tasks

**Fase: [MVP]**

Checklist de implementação. Ordem: Backend → Frontend → Testes. Referências: [design.md](design.md), [requirements.md](requirements.md), [data-model](../../01-arquitetura/data-model.md#user), [api-conventions](../../01-arquitetura/api-conventions.md).

## Backend

### Model / Migration
- [x] Definir modelo `User` no ORM conforme [data-model](../../01-arquitetura/data-model.md#user) (campos, enums `role`/`status`/`origem`).
- [x] Migration: coluna `email` como `citext` com índice único; `senha_hash` nullable.
- [x] Migration: colunas base (`id` uuid, `created_at`, `updated_at`, `deleted_at`) e `ultimo_login_at`.
- [x] Seed opcional: usuário `ADMIN` inicial via env.

### DTO / Validação
- [x] `RegisterDto` (`nome`, `email` email, `senha` min 8).
- [x] `LoginDto` (`email`, `senha`).
- [x] `RefreshDto` / `LogoutDto` (`refreshToken`).
- [x] `ForgotPasswordDto` (`email`) e `ResetPasswordDto` (`token`, `senhaNova`).
- [x] `UpdateMeDto` (`nome?`, `email?`) e `ChangePasswordDto` (`senhaAtual`, `senhaNova`).
- [x] `AdminUpdateUserDto` (`role?`, `status?`).

### Service
- [x] `AuthService.register` — unicidade de email, hash, criação `ALUNO/PROPRIO/ATIVO`.
- [x] `AuthService.login` — verificação de credenciais, checagem de `status`, atualização de `ultimo_login_at`, emissão de tokens.
- [x] `AuthService.refresh` — validação + rotação de refresh.
- [x] `AuthService.logout` — inserção do `jti` na lista de negação (cache).
- [x] `AuthService.forgotPassword` / `resetPassword` — geração/validação de token assinado de uso único.
- [x] `UsersService.getMe` / `updateMe` / `changePassword`.
- [x] `UsersService.list` (paginação/filtro `role`/`status`/`q`), `getById`, `adminUpdate` (com regra do último admin).
- [x] Utilitário de hash (argon2/bcrypt) e serviço de emissão/verificação de JWT.

### Controller
- [x] `AuthController` com rotas `/auth/*` do [design](design.md#endpoints-rest).
- [x] `UsersController` com rotas `/users/*` (`me` e administrativas).
- [x] Aplicar `AuthGuard` e `RolesGuard(ADMIN)` onde exigido.

### Transversais
- [x] `AuthGuard` (valida access, injeta `req.user`).
- [x] `RolesGuard` + decorator `@Roles(...)`.
- [x] Interceptor de serialização (remove `senhaHash`, `snake_case`→`camelCase`).
- [x] Rate limiting em `login`/`forgot-password`/`reset-password` (`429`).
- [x] Integração com serviço de email (link de reset) — pode ser stub no MVP.

## Frontend (Angular)

### Telas / Componentes
- [x] Tela de login.
- [x] Tela de cadastro.
- [x] Tela "esqueci minha senha" e tela de redefinição via link com token.
- [x] Tela de perfil (visualizar/editar `nome`/`email`).
- [x] Tela de alteração de senha.
- [x] Tela administrativa de listagem/filtro de usuários (role `ADMIN`).

### Serviços
- [x] `AuthService` (login, register, refresh, logout, forgot/reset) com armazenamento seguro de tokens.
- [x] `UsersService` (getMe, updateMe, changePassword, admin list/update).
- [x] HTTP interceptor: injeta `Authorization: Bearer`, trata `401` (refresh automático) e `403`.

### Guards
- [x] `authGuard` (rota exige login).
- [x] `roleGuard` parametrizável (ex.: `ADMIN`-only) para áreas internas.
- [x] Redirecionamento pós-login e proteção de rotas privadas.

## Testes
- [x] Unit (service): register (email duplicado → 409), login (credenciais/`status`), refresh, reset (token usado/expirado → 422), regra do último admin.
- [x] Unit: guards `AuthGuard`/`RolesGuard` (401/403).
- [x] Integração/e2e: fluxo completo register → login → refresh → me → logout.
- [x] Integração: rotas administrativas negam `ALUNO` (403).
- [x] Verificar que nenhuma resposta expõe `senhaHash`.

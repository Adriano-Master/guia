# Auth e Usuários — Design

**Fase: [MVP]**

## Entidades envolvidas

Única entidade persistida por esta feature (ver [data-model.md](../../01-arquitetura/data-model.md#user)):

- **[`User`](../../01-arquitetura/data-model.md#user)** — `id`, `nome`, `email` (citext único), `senha_hash`, `role` (`ADMIN`/`MODERADOR`/`PROFESSOR`/`ALUNO`), `status` (`ATIVO`/`INATIVO`/`PENDENTE`), `origem` (`PROPRIO`/`HOTMART`), `ultimo_login_at`.

> **Decisão importante (sem novas entidades):** o [data-model](../../01-arquitetura/data-model.md) é a fonte única e **não** possui tabelas de refresh token ou de token de reset. Portanto:
> - **Refresh token**: JWT assinado e **stateless** (não persistido). Logout/invalidção usa lista de negação em memória/cache (ex.: Redis) ou rotação por versão de token — infraestrutura, não entidade de domínio.
> - **Reset de senha**: token assinado stateless (JWT/HMAC com expiração e `jti`) enviado por email; uso único garantido por marcação em cache. Nenhuma tabela nova é introduzida.

## Endpoints REST

Base `/api/v1` conforme [api-conventions.md](../../01-arquitetura/api-conventions.md). Corpo em `camelCase`. Erros no [envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão).

### Autenticação — `/auth`

| Método | Caminho | Autorização | Request (resumo) | Response (resumo) |
|---|---|---|---|---|
| POST | `/auth/register` | Público | `{ nome, email, senha }` | `201` `{ user }` (sem `senhaHash`) |
| POST | `/auth/login` | Público | `{ email, senha }` | `200` `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | Público (refresh no corpo) | `{ refreshToken }` | `200` `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | Autenticado | `{ refreshToken }` | `204` |
| POST | `/auth/forgot-password` | Público | `{ email }` | `204` (sempre) |
| POST | `/auth/reset-password` | Público (token no corpo) | `{ token, senhaNova }` | `204` |

### Usuários — `/users`

| Método | Caminho | Autorização | Request (resumo) | Response (resumo) |
|---|---|---|---|---|
| GET | `/users/me` | Autenticado | — | `200` `{ user }` |
| PATCH | `/users/me` | Autenticado | `{ nome?, email? }` | `200` `{ user }` |
| POST | `/users/me/password` | Autenticado | `{ senhaAtual, senhaNova }` | `204` |
| GET | `/users` | `ADMIN` | query: `?page&pageSize&sort&role&status&q` | `200` paginado `{ data, page, pageSize, total }` |
| GET | `/users/{id}` | `ADMIN` | — | `200` `{ user }` / `404` |
| PATCH | `/users/{id}` | `ADMIN` | `{ role?, status? }` | `200` `{ user }` |

**Payload `user` (serialização):** `{ id, nome, email, role, status, origem, ultimoLoginAt, createdAt, updatedAt }`. Nunca inclui `senhaHash`.

## Fluxos principais

### Cadastro (aluno)
1. Controller valida DTO (`nome`, `email` formato, `senha` ≥ 8).
2. Service checa unicidade de email → se existe, `409 CONFLICT`.
3. Gera `senha_hash` (bcrypt/argon2); cria `User` com `role=ALUNO`, `origem=PROPRIO`, `status=ATIVO`.
4. Retorna `201` com `user` serializado.

### Login
1. Valida DTO; busca `User` por email (citext).
2. Se não existe, `status != ATIVO`, ou `senha_hash` nulo, ou hash não confere → `401` genérico.
3. Emite access (~15 min, claims `sub/role/origem`) + refresh (~7 dias); atualiza `ultimo_login_at`.
4. Retorna tokens + `user`.

### Refresh
1. Verifica assinatura/expiração do refresh e se não está na lista de negação.
2. Emite novo par (rotação de refresh recomendada).
3. Refresh inválido → `401`.

### Recuperação de senha
1. `forgot-password`: se email existe e usuário elegível, gera token de reset assinado (`jti`, exp ~30 min) e envia por email. Responde `204` sempre.
2. `reset-password`: valida token (assinatura, exp, `jti` não usado), define nova `senha_hash`, marca `jti` como usado. Se usuário era `HOTMART`/`PENDENTE` sem senha, passa a `ATIVO`.

### Autorização por role (transversal)
- `AuthGuard` valida access token e injeta `req.user`.
- `RolesGuard` compara `req.user.role` com roles exigidos pela rota; `ALUNO` bloqueado em rotas internas → `403`.
- Recursos de aluno são escopados ao próprio `sub` (ver [api-conventions](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)) — aplicado nas features de aluno.

## Decisões técnicas

- **Algoritmo de hash:** argon2id (preferido) ou bcrypt (custo ≥ 12). Configurável por env.
- **Segredos JWT:** `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` distintos (ver [overview](../../01-arquitetura/overview.md#4-ambientes)).
- **Claims do access:** `sub`, `role`, `origem`, `iat`, `exp`. Sem dados sensíveis.
- **Invalidação de refresh:** lista de negação por `jti` em cache/Redis com TTL = validade do refresh (infra, sem entidade nova).
- **Mensagens genéricas** em login/forgot para não vazar existência de conta.
- **Rate limiting** em `/auth/login`, `/auth/forgot-password` e `/auth/reset-password` → `429 RATE_LIMITED`.
- **Proteção do último admin:** service impede desativar/rebaixar o último `ADMIN` ativo (`409`).
- **Serialização:** interceptor remove `senhaHash` e converte `snake_case`→`camelCase`.

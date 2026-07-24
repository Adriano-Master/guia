# Auth e Usuários — Requirements

**Fase: [MVP]**

## Objetivo

Prover autenticação própria (email/senha) e gestão de identidade/perfil para todos os usuários da plataforma — internos (`ADMIN`, `MODERADOR`, `PROFESSOR`) e externos (`ALUNO`). Emitir e renovar tokens **JWT** (access + refresh), controlar acesso por **role** e permitir cadastro, edição de perfil e recuperação de senha. É a base de autorização de todas as demais features.

> Escopo **fora** desta feature: provisionamento via Hotmart. Usuários com `origem = HOTMART` são criados/atualizados pela feature de integração (Fase 2, ver [integracao-hotmart](../integracao-hotmart/requirements.md)); aqui apenas reconhecemos essa origem e permitimos que tais usuários definam senha e façam login pelos mesmos fluxos.

## Personas

Ver [visão de produto](../../00-visao-produto.md#3-personas). Divisão central de autorização: **interno** (`ADMIN`/`MODERADOR`/`PROFESSOR`) vs **externo** (`ALUNO`).

## User stories

- Como **visitante (aluno)**, quero me cadastrar com nome, email e senha, para acessar a plataforma e começar a estudar.
- Como **usuário**, quero fazer login com email e senha e receber um token, para usar as áreas protegidas.
- Como **usuário logado**, quero renovar meu acesso sem digitar a senha de novo, para manter a sessão ativa com segurança.
- Como **usuário logado**, quero fazer logout, para encerrar a sessão no dispositivo.
- Como **usuário**, quero ver e editar meu perfil (nome, email), para manter meus dados corretos.
- Como **usuário**, quero alterar minha senha informando a senha atual, para manter minha conta segura.
- Como **usuário que esqueceu a senha**, quero solicitar recuperação por email e definir uma nova senha via link, para recuperar o acesso.
- Como **usuário provisionado pela Hotmart** (`origem = HOTMART`, `senha_hash` nulo), quero definir minha senha pela primeira vez, para conseguir logar.
- Como **Admin**, quero listar, filtrar e alterar `role`/`status` de usuários, para administrar a plataforma.
- Como **Admin**, quero desativar (soft delete / `status = INATIVO`) um usuário, para revogar seu acesso sem apagar histórico.

## Critérios de aceitação

- [ ] `POST /api/v1/auth/register` cria `User` com `role = ALUNO`, `origem = PROPRIO`, `status = ATIVO` e `senha_hash` gerado com bcrypt/argon2; nunca retorna `senhaHash`.
- [ ] Email é único (case-insensitive, coluna `citext`); cadastro com email já existente retorna `409 CONFLICT` com `code = CONFLICT`.
- [ ] Senha exigida com mínimo de 8 caracteres; violação retorna `422 VALIDATION_ERROR` com `details[].field = "senha"`.
- [ ] `POST /api/v1/auth/login` com credenciais válidas retorna `accessToken` (~15 min) e `refreshToken` (~7 dias) e atualiza `ultimo_login_at`.
- [ ] Login com email inexistente, senha errada ou `status != ATIVO` retorna `401 UNAUTHENTICATED` com mensagem genérica (não revela qual dos dois falhou).
- [ ] `POST /api/v1/auth/refresh` com refresh válido retorna novo par de tokens; refresh inválido/expirado retorna `401`.
- [ ] `POST /api/v1/auth/logout` invalida o refresh corrente e retorna `204`.
- [ ] `GET /api/v1/users/me` retorna o perfil do usuário autenticado (sem `senhaHash`).
- [ ] `PATCH /api/v1/users/me` atualiza `nome`/`email`; troca de email para um já usado retorna `409`.
- [ ] `POST /api/v1/users/me/password` exige `senhaAtual` correta e `senhaNova` válida; senha atual errada retorna `422`.
- [ ] `POST /api/v1/auth/forgot-password` sempre retorna `204` (não revela se o email existe) e, se existir, envia link com token assinado de curta validade.
- [ ] `POST /api/v1/auth/reset-password` com token válido define nova `senha_hash` e invalida o token; token expirado/usado retorna `422`.
- [ ] Rotas administrativas (`GET /api/v1/users`, `PATCH /api/v1/users/{id}`) exigem role `ADMIN`; acesso por não-admin retorna `403 FORBIDDEN`.
- [ ] Toda rota protegida sem `Authorization: Bearer` válido retorna `401 UNAUTHENTICATED`.
- [ ] Erros seguem o [envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão); listagens seguem [paginação](../../01-arquitetura/api-conventions.md#4-paginação-filtro-ordenação).

## Regras de negócio

- **RN-01 — Roles.** `role ∈ {ADMIN, MODERADOR, PROFESSOR, ALUNO}`. Cadastro público sempre cria `ALUNO`. Elevação de role só por `ADMIN` via rota administrativa.
- **RN-02 — Interno vs externo.** `ADMIN`/`MODERADOR`/`PROFESSOR` = interno; `ALUNO` = externo. Guards de outras features dependem dessa distinção (ver [api-conventions](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)).
- **RN-03 — Status.** `status ∈ {ATIVO, INATIVO, PENDENTE}`. Só `ATIVO` autentica. `PENDENTE` reservado para usuários Hotmart sem senha definida. `INATIVO` = acesso revogado.
- **RN-04 — Origem.** `origem ∈ {PROPRIO, HOTMART}`. Cadastro próprio → `PROPRIO`. Registros `HOTMART` são criados pela feature de integração; um usuário `HOTMART` com `senha_hash` nulo está em `PENDENTE` até definir senha (via fluxo de reset/definição), passando a `ATIVO`.
- **RN-05 — Hash de senha.** `senha_hash` nunca trafega em resposta nem em log. Comparação sempre por função de verificação do algoritmo (bcrypt/argon2).
- **RN-06 — Tokens.** Access token curto carrega `sub` (userId), `role`, `origem`. Refresh de vida longa; logout invalida o refresh corrente.
- **RN-07 — Recuperação de senha.** Token de reset é assinado (JWT dedicado ou HMAC), de uso único e curta validade (~30 min); resposta de `forgot-password` é sempre `204` para não vazar existência de conta.
- **RN-08 — Soft delete.** Desativação usa `status = INATIVO` e/ou `deleted_at` (convenção global do [data-model](../../01-arquitetura/data-model.md)); histórico (matrículas, sessões) é preservado.
- **RN-09 — Unicidade de email.** Garantida por `citext` único no banco e checada no service antes de inserir/atualizar.

## Casos de borda

- Cadastro concorrente com o mesmo email → um vence, o outro recebe `409` (constraint de unicidade).
- Login de usuário `INATIVO` ou `PENDENTE` → `401` genérico.
- Refresh reutilizado após logout → `401`.
- Reset com token já usado ou expirado → `422`.
- `forgot-password` para email inexistente → `204` (sem envio, sem erro).
- Usuário `HOTMART` com `senha_hash` nulo tentando login por senha → `401` até definir senha.
- Admin tentando rebaixar/desativar a si mesmo → permitido, mas alertar no frontend (evitar auto-lockout do último admin — validação no service: bloquear desativar o último `ADMIN` ativo com `409`).
- Troca de email para um valor já em uso por outro usuário → `409`.

## Dependências

- Fonte de entidades: [../../01-arquitetura/data-model.md](../../01-arquitetura/data-model.md) — entidade `User`.
- Convenções de API/JWT/erro: [../../01-arquitetura/api-conventions.md](../../01-arquitetura/api-conventions.md).
- Arquitetura/camadas: [../../01-arquitetura/overview.md](../../01-arquitetura/overview.md).
- Consumidores desta feature (dependem dos guards de role): [turmas](../turmas/requirements.md), [plano-de-estudo](../plano-de-estudo/requirements.md), e demais features de aluno.
- Origem `HOTMART` provisionada por (Fase 2): [integracao-hotmart](../integracao-hotmart/requirements.md).

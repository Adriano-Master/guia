# Plataforma de Planejamento de Estudos

Plataforma para alunos de concursos públicos organizarem planos de estudo, cronogramas, sessões e progresso. Especificações em [`.specs/`](.specs/).

**Stack:** PostgreSQL 16 · NestJS + Prisma (TypeScript) · Angular PWA · Docker Compose.

## Subir tudo com Docker

```bash
cp .env.example .env   # ajuste os segredos (openssl rand -hex 32)
docker compose -f docker/docker-compose.yml up --build
```

| Serviço | URL / porta | Observação |
|---|---|---|
| `web` (nginx + Angular) | http://localhost:8081 | Proxy de `/api/` para a API |
| `api` (NestJS) | http://localhost:3001 | Prefixo `/api/v1`; `GET /health` fora do prefixo (healthcheck Docker) |
| `db` (PostgreSQL 16) | localhost:5433 | Exposta só para dev |

As migrations do Prisma são aplicadas automaticamente no start do container `api` (`prisma migrate deploy`).

## Desenvolvimento local (backend fora do Docker)

```bash
docker compose -f docker/docker-compose.yml up db   # só o banco
cd backend
# no .env da raiz, troque DATABASE_URL para a variante localhost (comentada)
npm install
npm run prisma:migrate:dev   # cria/aplica migrations
PORT=3001 npm run start:dev  # API em http://localhost:3001 (3000 pode estar em uso por outro serviço)
```

## Migrations e seed

```bash
cd backend
npm run prisma:migrate:dev      # dev: cria migration a partir do schema
npm run prisma:migrate:deploy   # aplica migrations pendentes (CI/prod)
npm run seed                    # cria/atualiza o ADMIN inicial (upsert por email) a partir de SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD no .env
```

## Testes

```bash
cd backend
npm test        # unit
npm run test:e2e
```

## Estrutura

```
backend/   API NestJS (src/modules por feature, src/common transversais, prisma/)
frontend/  PWA Angular (mantido em paralelo)
docker/    docker-compose.yml, api.Dockerfile, web.Dockerfile, nginx.conf
.specs/    Fonte da verdade: arquitetura, features e requisitos
```

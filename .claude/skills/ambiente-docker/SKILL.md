---
name: ambiente-docker
description: Use para criar ou subir o ambiente de desenvolvimento em Docker do projeto (ex.: "suba o ambiente", "crie o docker-compose", "configure o banco e rode as migrations", "prepare o seed"). Gera/opera docker-compose com db+api+web, Dockerfiles multi-stage, migrations e seed conforme as specs de arquitetura e qualidade.
---

# Skill: Ambiente Docker de desenvolvimento

Prepara e opera o ambiente local. Tudo roda em Docker (requisito do projeto). Referências: `.specs/01-arquitetura/overview.md` (serviços e variáveis) e `.specs/03-nao-funcionais/qualidade.md` (Docker/entrega).

## Serviços (docker-compose)
```
db    → postgres:16   (volume persistente, healthcheck)
api   → backend NestJS (build via api.Dockerfile, depende de db saudável)
web   → frontend Angular (build via web.Dockerfile)
# opcional: pgadmin
```

## Checklist
- [ ] `docker/docker-compose.yml` com `db`, `api`, `web`; `depends_on` com `condition: service_healthy` no db; rede compartilhada; volumes.
- [ ] **Dockerfiles multi-stage** (build + runtime enxuto) para `api` e `web`.
- [ ] **Variáveis de ambiente** por `.env` (nunca commitado): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_BASE_URL`, e (Fase 2) `HOTMART_HOTTOK`. Fornecer `.env.example`.
- [ ] **Healthcheck** `/health` na API para orquestração.
- [ ] **Migrations**: aplicar no start da api (`prisma migrate deploy`) ou passo dedicado; em dev, `prisma migrate dev`.
- [ ] **Seed** de dados para dev/testes (usuário admin, um plano oficial de exemplo com disciplinas/temas/subtemas e pesos somando 100).

## Comandos úteis
- Subir: `docker compose -f docker/docker-compose.yml up --build`
- Migrations (dev): `docker compose exec api npx prisma migrate dev`
- Seed: `docker compose exec api npm run seed`
- Logs: `docker compose logs -f api`

## Boas práticas
- Um comando deve subir o ambiente inteiro para dev.
- Segredos fora do repositório; em produção, usar secret manager.
- Backup do Postgres e política de retenção (produção).

# Arquitetura — Visão Geral

## 1. Stack (fixada)

| Camada | Tecnologia | Observações |
|---|---|---|
| Banco | PostgreSQL 16+ | Fonte única de verdade relacional. |
| Backend | Node.js (LTS) + TypeScript | Padrão **MVC** + **ORM**. |
| ORM | Prisma **ou** Sequelize/TypeORM | Decisão em [ADR](#8-decisões-em-aberto-adr). Recomendado: **Prisma** (migrations + type-safety). |
| Framework HTTP | Express **ou** NestJS | NestJS já impõe MVC/DI; Express é mais leve. Recomendado: **NestJS** pelo alinhamento com MVC e Angular. |
| Frontend | Angular (v17+) | PWA, standalone components, signals. |
| Orquestração | Docker + Docker Compose | Serviços: `db`, `api`, `web`, (opcional) `pgadmin`. |

## 2. Estilo arquitetural

- **API REST** stateless, autenticação por **JWT** (access + refresh). Convenções em [api-conventions.md](api-conventions.md).
- Backend em camadas **MVC** + serviço:
  - **Controller** → recebe HTTP, valida DTO, chama serviço.
  - **Service** → regra de negócio (ex.: algoritmo de cronograma).
  - **Model/Repository** → acesso a dados via ORM.
  - **DTO/Validation** → contratos de entrada/saída.
- Regras de negócio **nunca** no controller nem no ORM diretamente — sempre no service (testável isoladamente).

## 3. Organização de pastas (proposta)

```
/backend
  /src
    /modules
      /auth        /users      /turmas
      /planos      /cronograma /sessoes
      /progresso   /questoes   /estatisticas
      /gamificacao /hotmart
    /common        # guards, interceptors, filtros de erro, paginação
    /config        # env, database
    prisma/ (ou /entities)  # schema + migrations
  /test
/frontend
  /src/app
    /core          # auth, http interceptors, guards, theme
    /shared        # componentes reutilizáveis, layout (menu lateral)
    /features      # 1 pasta por feature, espelhando o backend
    /pwa           # service worker, manifest
/docker
  docker-compose.yml
  api.Dockerfile   web.Dockerfile
```

Cada módulo do backend corresponde a uma pasta de feature em `02-features/`.

## 4. Ambientes

- `local` (Docker Compose), `staging`, `production`.
- Config por variáveis de ambiente (`.env`), nunca commitadas. Exemplos: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `HOTMART_HOTTOK`, `APP_BASE_URL`.

## 5. Fluxo de dados (alto nível)

```
Aluno (PWA Angular)
   │  HTTPS + JWT
   ▼
API REST (NestJS/Express)  ── Service (regras) ── ORM ── PostgreSQL
   ▲
   │  Webhook (Postback, Fase 2)
Hotmart ───────────────────────────────────────────►  /webhooks/hotmart
```

## 6. Transversais

- **AuthZ** por role em guard/middleware; ver [api-conventions.md](api-conventions.md#autenticação-e-autorização).
- **Tratamento de erro** centralizado (filtro global) com formato de erro padrão.
- **Migrations** versionadas no repositório (nunca alterar schema à mão em produção).
- **Observabilidade** e **qualidade** em [03-nao-funcionais/qualidade.md](../03-nao-funcionais/qualidade.md).

## 7. Modelo de dados

O modelo relacional completo (entidades, relações, ERD) está em [data-model.md](data-model.md). É a **fonte única** de entidades — nenhuma spec de feature deve introduzir entidade que não esteja lá.

## 8. Decisões em aberto (ADR)

| # | Decisão | Recomendação | Status |
|---|---|---|---|
| ADR-01 | ORM: Prisma vs TypeORM | Prisma | A confirmar na implementação |
| ADR-02 | HTTP framework: NestJS vs Express | NestJS | A confirmar |
| ADR-03 | Estratégia de fuso horário (cronograma) | Armazenar UTC, exibir no TZ do usuário | A confirmar em [cronograma design](../02-features/cronograma-e-calendario/design.md) |

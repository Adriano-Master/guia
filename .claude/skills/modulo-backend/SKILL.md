---
name: modulo-backend
description: Use ao criar ou completar um módulo do backend NestJS para uma entidade do domínio (ex.: "crie o módulo de planos", "gere o CRUD de turmas no backend", "adicione o service e controller de sessões"). Gera Prisma model/migration + service + controller + DTOs seguindo o data-model e as convenções de API do projeto.
---

# Skill: Gerar um módulo backend (NestJS + Prisma)

Gabarito para criar um módulo backend coeso e consistente com as specs. Backend: **NestJS + Prisma + PostgreSQL**, padrão MVC + serviço.

## Antes de gerar
- Identifique a(s) entidade(s) em `.specs/01-arquitetura/data-model.md` — **use só o que existe lá** (campos, tipos, uniques, FKs, invariantes).
- Releia as rotas/regras da feature em `.specs/02-features/<feature>/design.md`.
- Siga `.specs/01-arquitetura/api-conventions.md` para toda rota.

## Estrutura de um módulo (`/backend/src/modules/<modulo>/`)
```
<modulo>.module.ts        # declara controller + service (DI)
<modulo>.controller.ts    # rotas HTTP: valida DTO, chama service, sem regra de negócio
<modulo>.service.ts       # REGRAS DE NEGÓCIO + acesso via PrismaService
dto/create-*.dto.ts       # validação de entrada (class-validator)
dto/update-*.dto.ts
dto/*-response.dto.ts      # (ou mapper) serialização camelCase
```

## Checklist
- [ ] **Prisma model** em `schema.prisma` espelhando a tabela do data-model: `@id` uuid, `@map` para snake_case, uniques compostos, relações/FKs, `@@map("tabela_plural")`, `created_at/updated_at`, soft delete (`deleted_at`) quando aplicável.
- [ ] **Migration** gerada (`prisma migrate dev --name <nome>`) — nunca editar schema à mão em produção.
- [ ] **Service** com as regras da spec (ex.: validar Σ pesos=100 → lançar erro de negócio; "um cronômetro por vez" → 409; idempotência por chave única). Regra de negócio **só aqui**.
- [ ] **Controller**: rotas sob `/api/v1`, métodos/status corretos (POST→201, DELETE→204…), paginação `?page&pageSize` retornando `{data,page,pageSize,total}`, ordenação `?sort=-campo`.
- [ ] **DTOs** validados; datas ISO-8601 UTC; JSON em `camelCase`.
- [ ] **Autorização**: guard por role; recursos de aluno **escopados ao dono** (403 em acesso cruzado).
- [ ] **Erros**: deixe o filtro global de exceções produzir o envelope `{ error: { code, message, details, traceId } }`.

## Convenção de nomes
- Banco: `snake_case` (tabelas no plural). API/TS: `camelCase`. Mapear na borda (Prisma `@map` + serializer), não vazar snake_case para o cliente.

## Depois de gerar
Rode `build`/`lint` para garantir que compila. **Não escreva testes aqui** — encaminhe ao agente `testador`. Resuma arquivos criados e regras implementadas.

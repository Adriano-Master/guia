# Requisitos Não-Funcionais — Qualidade, Segurança e Operação

## 1. Segurança

- [ ] Senhas com hash **argon2id** ou **bcrypt** (cost adequado); nunca em texto puro.
- [ ] JWT: access curto + refresh rotativo; segredos por env; refresh revogável (blacklist/rotação).
- [ ] Autorização por role e **escopo por dono** (aluno só acessa os próprios dados) — ver [api-conventions](../01-arquitetura/api-conventions.md#3-autenticação-e-autorização).
- [ ] Validação/sanitização de todo input (DTO); proteção contra SQL injection via ORM parametrizado.
- [ ] Rate limiting em `/auth/*` e `/webhooks/hotmart`.
- [ ] Webhook Hotmart autenticado por **Hottok** e idempotente — ver [integracao-hotmart](../02-features/integracao-hotmart/design.md).
- [ ] CORS restrito à origem do PWA; HTTPS obrigatório; headers de segurança (Helmet).
- [ ] Segredos fora do repositório (`.env`, secret manager em produção).

## 2. LGPD / privacidade

- [ ] Base legal para dados de alunos; consentimento no cadastro.
- [ ] Direito de exportação e exclusão de conta (soft delete + rotina de purga).
- [ ] Minimização: coletar só o necessário; dados da Hotmart limitados ao provisionamento de acesso.

## 3. Testes

- [ ] **Unit** para regras de negócio nos services (destaque: algoritmo do [cronograma](../02-features/cronograma-e-calendario/design.md), validação de pesos, agregação de progresso).
- [ ] **Integração** para endpoints (por feature).
- [ ] **E2E** dos fluxos críticos: cadastro→login, gerar cronograma→estudar (cronômetro)→marcar progresso.
- [ ] Cobertura mínima acordada para services (ex.: ≥ 80% nas regras de negócio).
- [ ] Dados de seed para dev/testes.

## 4. Performance e escalabilidade

- [ ] Índices conforme [data-model](../01-arquitetura/data-model.md#8-índices-e-integridade-destaques).
- [ ] Consultas de estatística/ranking agregadas (views materializadas ou agregados) para não varrer sessões a cada request.
- [ ] Paginação obrigatória em listagens.

## 5. Observabilidade e operação

- [ ] Logs estruturados (JSON) com `traceId` correlacionado ao [envelope de erro](../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão).
- [ ] Healthcheck (`/health`) para orquestração Docker.
- [ ] Migrations versionadas e aplicadas em deploy (nunca schema manual em produção).
- [ ] Backup do PostgreSQL e política de retenção.

## 6. Docker / entrega

- [ ] `docker-compose` sobe `db`, `api`, `web` para dev com um comando.
- [ ] Dockerfiles multi-stage (build + runtime enxuto) para api e web.
- [ ] Variáveis de ambiente documentadas ([overview](../01-arquitetura/overview.md#4-ambientes)).

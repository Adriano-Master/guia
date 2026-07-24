# Integração Hotmart — Tarefas

**Fase:** Fase 2 (todos os itens). Ordem: Backend → Frontend (mínimo) → Testes.

## Backend

- [ ] Criar módulo `hotmart` (controller + service + repository).
- [ ] Migration/entidades `HotmartWebhookEvent` e `HotmartAccess` conforme [data-model](../../01-arquitetura/data-model.md#7-integração-hotmart-fase-2) (uniques `evento_id` e `user_id`).
- [ ] Env: `HOTMART_HOTTOK`, `HOTMART_PRODUCT_MAP`, `APP_BASE_URL`.
- [ ] Middleware de validação **Hottok** (comparação em tempo constante) → `401` se inválido.
- [ ] Endpoint `POST /api/v1/webhooks/hotmart` (fora do guard JWT).
- [ ] DTO/schema de validação do payload Hotmart (extrair `evento_id`, `tipo`, `buyer.email`, `product.id`, `transaction`).
- [ ] Persistência idempotente: `INSERT HotmartWebhookEvent` tratando conflito de `evento_id` → `200` dedup.
- [ ] Config/serviço de mapeamento produto → `turmaId`.
- [ ] Handler `PURCHASE_APPROVED`: resolve/cria `User` (origem HOTMART, PENDENTE), `UPSERT HotmartAccess` ATIVO, cria/reativa `Matricula`, dispara magic link.
- [ ] Handler revogação (`PURCHASE_REFUNDED` / `PURCHASE_CANCELED` / `SUBSCRIPTION_CANCELLATION`): `HotmartAccess=REVOGADO`, `Matricula=INATIVA`, `User=INATIVO`.
- [ ] Guarda de ordenação de eventos (não sobrescrever com evento mais antigo que `evento_ultimo`/`atualizado_em`).
- [ ] Marcar `processado_em` ao concluir; deixar nulo em falha para reprocesso.
- [ ] Tratamento de produto sem mapeamento (persistir, alertar, `200`).
- [ ] Integração com envio de magic link ([auth-e-usuarios](../auth-e-usuarios/design.md)).
- [ ] Log/observabilidade dos eventos recebidos e do resultado ([qualidade](../../03-nao-funcionais/qualidade.md)).

## Frontend Angular

> Feature quase sem UI (fluxo servidor-a-servidor). A superfície de aluno é a definição de senha via magic link, que pertence a [auth-e-usuarios](../auth-e-usuarios/design.md).

- [ ] (Opcional/Admin) Tela interna de auditoria: listar `HotmartWebhookEvent` recentes e status de processamento.
- [ ] Garantir que a tela de "definir senha / primeiro acesso" (auth) trate o magic link vindo da origem Hotmart.

## Testes

- [ ] Unit: Hottok inválido → `401`, nada persistido (CA-01).
- [ ] Unit: mapeamento produto → turma (incluindo produto sem mapa — CA-07).
- [ ] Integração: `PURCHASE_APPROVED` email novo cria User PENDENTE + Access ATIVO + Matricula + magic link (CA-04).
- [ ] Integração: `PURCHASE_APPROVED` email existente reativa sem duplicar User (CA-05).
- [ ] Integração: evento duplicado (`evento_id` repetido) não reprocessa (CA-03).
- [ ] Integração: eventos de revogação → Access REVOGADO, Matricula INATIVA, User INATIVO (CA-06).
- [ ] Integração: reembolso sem Access prévio → sem-op, `200`.
- [ ] Integração: evento fora de ordem não reativa acesso já revogado.
- [ ] Integração: falha de negócio após persistir evento não retorna `5xx` à Hotmart (CA-08).

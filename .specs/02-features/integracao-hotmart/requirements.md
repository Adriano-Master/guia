# Integração Hotmart — Requisitos

**Fase:** Fase 2 (tudo).

## Objetivo

Provisionar e revogar acesso de alunos automaticamente a partir de eventos de compra da
**Hotmart**, recebidos via **Webhook (Postback)**. Uma compra aprovada cria/ativa o
[`User`](../../01-arquitetura/data-model.md#user) (origem `HOTMART`) e concede acesso à
turma/plano do produto; reembolso/cancelamento revoga o acesso. Todo processamento é
**idempotente** e autenticado por **Hottok**.

## User stories

- **US-01** — Como comprador Hotmart, ao ter minha compra aprovada, quero receber acesso à plataforma automaticamente (via magic link/credenciais), sem cadastro manual.
- **US-02** — Como operação, quero que reembolsos/cancelamentos **revoguem o acesso** automaticamente, para não manter alunos sem direito ativo.
- **US-03** — Como plataforma, quero que o **mesmo evento** nunca seja processado duas vezes, para não duplicar usuários nem enviar acessos repetidos.
- **US-04** — Como segurança, quero **rejeitar** webhooks não autênticos (Hottok inválido), para impedir provisão fraudulenta.

## Critérios de aceitação (testáveis)

- **CA-01** — `POST /api/v1/webhooks/hotmart` valida o **Hottok**; token ausente/incorreto → `401 UNAUTHENTICATED` e **nada** é processado.
- **CA-02** — Todo request autêntico é persistido em [`HotmartWebhookEvent`](../../01-arquitetura/data-model.md#hotmartwebhookevent) com `evento_id` único **antes** de processar.
- **CA-03** — Se o `evento_id` já existe (`processado_em` preenchido), o request retorna `200` **sem reprocessar** (idempotência — [api-conventions §7](../../01-arquitetura/api-conventions.md#7-idempotência-e-concorrência)).
- **CA-04** — `PURCHASE_APPROVED` de um email novo cria `User` (`origem=HOTMART`, `status=PENDENTE`), cria [`HotmartAccess`](../../01-arquitetura/data-model.md#hotmartaccess) `ATIVO`, matricula na turma mapeada e dispara magic link.
- **CA-05** — `PURCHASE_APPROVED` de um email já existente **reativa** o acesso (não cria `User` duplicado — email é único) e garante a matrícula.
- **CA-06** — `PURCHASE_REFUNDED`, `PURCHASE_CANCELED` ou `SUBSCRIPTION_CANCELLATION` marcam `HotmartAccess.status=REVOGADO`, `Matricula.status=INATIVA` e `User.status=INATIVO`.
- **CA-07** — Produto Hotmart sem mapeamento configurado → evento é persistido, marcado como não processável e retorna `200` (não derruba a fila); registra alerta.
- **CA-08** — O endpoint responde rápido (`2xx`) mesmo sob carga; falhas de negócio internas não devem gerar `5xx` para a Hotmart quando o evento já foi persistido (evita retentativas infinitas).

## Regras de negócio

- **RN-01** — Autenticidade: o `hottok` recebido é comparado ao segredo `HOTMART_HOTTOK` (env). O webhook **não usa JWT** (ver [design](design.md#autenticação-do-webhook)).
- **RN-02** — Idempotência: chave é `evento_id` (unique em `HotmartWebhookEvent`). O `INSERT` que colide com o unique é o mecanismo de deduplicação.
- **RN-03** — Mapeamento **produto Hotmart → turma/plano** é configuração (não entidade nova); ver [design](design.md#mapeamento-produto--turmaplano). `HotmartAccess.produto_hotmart` guarda o produto de origem.
- **RN-04** — `User` criado por Hotmart nasce `status=PENDENTE` e `origem=HOTMART`; passa a `ATIVO` ao definir senha (via magic link) ou no primeiro login.
- **RN-05** — Revogação preserva os dados históricos do aluno (soft: muda status, não apaga); reativação futura reaproveita o mesmo `User`.
- **RN-06** — `HotmartAccess.evento_ultimo` guarda o tipo do último evento aplicado; `atualizado_em` reflete a última transição.

## Casos de borda

- Evento fora de ordem (cancelamento chega antes da aprovação, por retentativa) → estado final coerente com o **último** evento por `atualizado_em`; aprovação antiga não reativa acesso já revogado por evento mais recente.
- Reembolso de compra nunca vista (sem `HotmartAccess`) → persiste evento, sem-op no acesso, retorna `200`.
- Retentativa da Hotmart do mesmo evento → deduplicado por `evento_id` (RN-02).
- Payload malformado mas Hottok válido → persiste bruto em `payload`, marca não processável, `200`.
- Aluno compra dois produtos → dois eventos, duas matrículas (turmas distintas); `HotmartAccess` reflete a transação mais recente.

## Dependências

- [auth-e-usuarios](../auth-e-usuarios/requirements.md) — criação de `User`, magic link, ativação de senha.
- [turmas](../turmas/requirements.md) — criação da `Matricula` na turma mapeada.
- [plano-de-estudo](../plano-de-estudo/requirements.md) — plano oficial vinculado à turma via `TurmaPlano`.
- Env: `HOTMART_HOTTOK`, `APP_BASE_URL` (ver [overview §4](../../01-arquitetura/overview.md#4-ambientes)).

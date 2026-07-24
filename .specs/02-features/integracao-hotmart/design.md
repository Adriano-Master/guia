# Integração Hotmart — Design

**Fase:** Fase 2.

## Entidades envolvidas

Fonte: [data-model.md](../../01-arquitetura/data-model.md). Nenhuma entidade nova.

- [`HotmartWebhookEvent`](../../01-arquitetura/data-model.md#hotmartwebhookevent) — log idempotente (`evento_id` unique, `tipo`, `payload` bruto, `processado_em`).
- [`HotmartAccess`](../../01-arquitetura/data-model.md#hotmartaccess) — 1:1 com `User`; `transacao_hotmart`, `produto_hotmart`, `status`, `evento_ultimo`.
- [`User`](../../01-arquitetura/data-model.md#user) — criado/ativado (`origem=HOTMART`) ou inativado.
- [`Turma`](../../01-arquitetura/data-model.md#turma) / [`Matricula`](../../01-arquitetura/data-model.md#matricula) — acesso concedido/revogado.
- [`Plano`](../../01-arquitetura/data-model.md#plano) / [`TurmaPlano`](../../01-arquitetura/data-model.md#turmaplano) — plano oficial já vinculado à turma (não é escrito aqui; herdado pela matrícula).

## Endpoint REST

Base `/api/v1`. Único endpoint público-para-Hotmart:

| Método | Rota | Autenticação | Sucesso |
|---|---|---|---|
| POST | `/webhooks/hotmart` | **Hottok** (não JWT) | `200` sempre que o evento for aceito/deduplicado |

- Não segue o guard de JWT/role das demais rotas (ver [api-conventions §3](../../01-arquitetura/api-conventions.md#3-autenticação-e-autorização)); usa validação Hottok (abaixo).
- Erros seguem o envelope padrão ([api-conventions §5](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão)): Hottok inválido → `401 UNAUTHENTICATED`.
- Retorna `2xx` rápido para evitar retentativas desnecessárias da Hotmart (CA-08).

### Autenticação do webhook
- A Hotmart envia o token no header `X-HOTMART-HOTTOK` (ou campo `hottok` no payload, conforme config do produto).
- Middleware dedicado compara com `HOTMART_HOTTOK` (env) em **tempo constante**; divergência → `401`, sem persistir nem processar (CA-01).

## Mapeamento produto → turma/plano

Não há entidade de mapeamento no data-model, então é **configuração** (env/JSON de config,
versionado por ambiente), não tabela nova:

```json
// HOTMART_PRODUCT_MAP (config)
{
  "1234567": { "turmaId": "uuid-turma-concurso-x" },
  "7654321": { "turmaId": "uuid-turma-concurso-y" }
}
```

- A chave é o `product.id`/`prod` do payload Hotmart; o valor aponta a `Turma`.
- A turma já tem seu plano oficial via `TurmaPlano` — matricular o aluno na turma concede acesso ao plano; nada é criado em `Plano`/`TurmaPlano` aqui.
- `HotmartAccess.produto_hotmart` guarda o id do produto para auditoria/reprocessamento.
- Produto sem entrada no mapa → evento persistido, marcado não processável, alerta, `200` (CA-07).

## Fluxos

### Recepção (comum a todos os eventos)
1. Middleware valida Hottok → senão `401` (CA-01).
2. Extrai `evento_id` e `tipo` do payload.
3. `INSERT` em `HotmartWebhookEvent` com `evento_id` (unique). Se **conflito** → evento já recebido: retorna `200` sem reprocessar (CA-03, RN-02).
4. Despacha para o handler do `tipo`. Ao concluir, seta `processado_em = now()`.
5. Responde `200`.

```
Hotmart ──POST /api/v1/webhooks/hotmart──► [Hottok?] ──► [INSERT evento_id]
   unique conflict → 200 (dedup)              │ novo
                                              ▼
                              handler por tipo → atualiza User/Access/Matricula
                                              ▼
                                     processado_em = now() → 200
```

### PURCHASE_APPROVED (provisão)
1. Resolve `User` por email (Hotmart `buyer.email`): existe → reusa; não existe → cria `User` (`origem=HOTMART`, `status=PENDENTE`, `senha_hash=null`).
2. `UPSERT` `HotmartAccess` (unique `user_id`): `status=ATIVO`, `transacao_hotmart`, `produto_hotmart`, `evento_ultimo=PURCHASE_APPROVED`, `atualizado_em=now()`.
3. Resolve `turmaId` pelo mapa do produto; cria/reativa `Matricula` (`status=ATIVA`) — respeitando unique `(turma_id, aluno_id)`.
4. Dispara **magic link** (definição de senha / primeiro acesso) via [auth-e-usuarios](../auth-e-usuarios/design.md) usando `APP_BASE_URL`.

### PURCHASE_REFUNDED / PURCHASE_CANCELED / SUBSCRIPTION_CANCELLATION (revogação)
1. Localiza `HotmartAccess` pela transação/comprador. Não existe → sem-op, `200`.
2. `HotmartAccess.status=REVOGADO`, `evento_ultimo=<tipo>`, `atualizado_em=now()`.
3. `Matricula.status=INATIVA` nas turmas concedidas por essa origem.
4. `User.status=INATIVO` (dados preservados — RN-05); efeito colateral: sai dos rankings ([gamificação RN-05](../gamificacao-ranking/requirements.md#regras-de-negócio)).

### Ordenação de eventos
- Antes de aplicar, compara com `HotmartAccess.atualizado_em`/`evento_ultimo`: um evento mais antigo que o último aplicado **não** sobrescreve o estado (evita que uma aprovação atrasada reative acesso já revogado).

## Decisões técnicas

- **Idempotência por `evento_id`** com unique constraint — o próprio banco deduplica; o handler é envolvido para ser seguro em retentativa (CA-03).
- **Persistir-antes-de-processar**: o payload bruto é salvo primeiro (`HotmartWebhookEvent.payload`), permitindo **reprocessamento** manual e auditoria.
- **Responder 2xx mesmo em erro de negócio** após persistir o evento, para não induzir retentativas infinitas; falhas ficam registradas (`processado_em` nulo) para reprocesso (CA-08).
- **Mapeamento por configuração**, não entidade — mantém fidelidade ao data-model (nenhuma tabela nova).
- **Hottok em tempo constante** e segredo só em env (`HOTMART_HOTTOK`), nunca no código.
- **Sem frontend dedicado**: o fluxo é servidor-a-servidor; a única superfície de UI é a de definição de senha via magic link, que pertence a [auth-e-usuarios](../auth-e-usuarios/design.md).

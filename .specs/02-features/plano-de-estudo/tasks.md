# Plano de Estudo — Tarefas

**Fase: [MVP]**

Base: [requirements.md](requirements.md) · [design.md](design.md).

## Backend

- [x] Modelar/migrar `Plano`, `Disciplina`, `Tema`, `Subtema`, `PesoDisciplina` conforme [data-model.md](../../01-arquitetura/data-model.md) (ids UUID, timestamps, soft delete, uniques).
- [x] Configurar FKs com `ON DELETE CASCADE` (Plano→Disciplina→Tema→Subtema; Plano→PesoDisciplina) e índices.
- [x] DTOs de entrada/saída (create/patch de Plano, Disciplina, Tema, Subtema; replace de pesos) com validação (class-validator/Zod).
- [x] `PlanoService.create` — define `tipo` conforme role (interno=OFICIAL permitido; aluno=PESSOAL) e `autor_id`.
- [x] `PlanoService.setPesos` — replace-all atômico com validação de invariante Σ = 100 → `422 VALIDATION_ERROR` com `details`.
- [x] `PlanoService.publicar` — valida Σ pesos = 100 e ≥1 disciplina; seta `publicado=true`.
- [x] `PlanoService.derivar` — deep copy em transação: cria Plano PESSOAL (`plano_origem_id`), copia Disciplinas/Temas/Subtemas/Pesos com remapeamento de FKs; valida origem OFICIAL + publicada.
- [x] Services de CRUD para Disciplina/Tema/Subtema (incl. reordenação via `ordem`).
- [x] Controllers/rotas sob `/api/v1` conforme tabela de endpoints do [design.md](design.md).
- [x] Guard de role (interno vs ALUNO) + verificação de propriedade (`autor_id`); acesso cruzado → `403`.
- [x] Serialização snake_case → camelCase; datas ISO-8601 UTC.
- [x] Paginação/filtros em `GET /planos` (`tipo`, `publicado`, `autorId`).

## Frontend Angular

- [x] Feature module `planos` (standalone components, signals) espelhando o backend.
- [x] Serviço HTTP `PlanosService` (CRUD, publicar, derivar, pesos) com interceptor JWT.
- [x] Tela de listagem de planos (OFICIAIS publicados + PESSOAIS do aluno) com filtros.
- [x] Editor de árvore Disciplina → Tema → Subtema (adicionar/editar/remover/reordenar).
- [x] Editor de pesos por disciplina com indicador de soma e validação client-side (Σ = 100) antes do `PUT`.
- [x] Ação "Publicar" (interno) com feedback de validação (pesos/disciplinas).
- [x] Ação "Criar meu plano a partir deste" (aluno) → chama `POST /planos/{id}/derivar` e navega ao plano derivado.
- [x] Tratamento do envelope de erro padrão (exibir `details` de `422`, `403`, `409`).
- [x] Responsivo + tema claro/escuro (ver [pwa-frontend](../../03-nao-funcionais/pwa-frontend.md)).

## Testes

- [x] Unit (service): invariante Σ = 100 aceita 100,00 e rejeita 99,99/100,01 (`422`) — CB-02.
- [x] Unit (service): `derivar` copia toda a árvore com novos ids e Σ pesos = 100 — CA-06, CA-09.
- [x] Unit (service): edição no plano derivado não altera o oficial (isolamento) — CA-07, RN-04.
- [x] Unit (service): derivar de plano não publicado / não-OFICIAL → `422` — CA-08, CB-05.
- [x] Unit (service): peso duplicado por disciplina → `409` — CA-04, CB-06.
- [x] Unit (service): publicar sem disciplinas → `422` — CA-05, CB-01.
- [x] Integração (API): autorização — aluno cria OFICIAL → `403`; aluno edita plano de outro → `403` — CA-01, CA-12.
- [x] Integração (API): fluxo completo criar→conteúdo→pesos→publicar (Fluxo A).
- [x] Integração (API): fluxo de derivação ponta a ponta (Fluxo B).
- [ ] E2E (frontend): editor de pesos bloqueia salvar quando Σ ≠ 100; ação "derivar" cria plano pessoal editável.

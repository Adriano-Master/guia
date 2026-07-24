# Turmas — Tasks

**Fase: [MVP]**

Checklist de implementação. Ordem: Backend → Frontend → Testes. Referências: [design.md](design.md), [requirements.md](requirements.md), [data-model](../../01-arquitetura/data-model.md), [api-conventions](../../01-arquitetura/api-conventions.md).

## Backend

### Model / Migration
- [x] Modelo `Turma` (`nome`, `descricao`, `professor_id` FK→User, `codigo_convite` único, `ativa`) — [data-model](../../01-arquitetura/data-model.md#turma).
- [x] Modelo `Matricula` (`turma_id`, `aluno_id`, `status`) com unique `(turma_id, aluno_id)` — [data-model](../../01-arquitetura/data-model.md#matricula).
- [x] Modelo `TurmaPlano` (`turma_id`, `plano_id`) com unique `(turma_id, plano_id)` — [data-model](../../01-arquitetura/data-model.md#turmaplano). (Hard delete no desvínculo, conforme design; sem `deleted_at` — soft delete quebraria o unique no re-vínculo.)
- [x] Migration com índices únicos (`codigo_convite`, `(turma_id, aluno_id)`, `(turma_id, plano_id)`) e colunas base (`id`, `created_at`, `updated_at`, `deleted_at`).
- [x] Enums `Matricula.status` (`ATIVA`/`INATIVA`).

### DTO / Validação
- [x] `CreateTurmaDto` (`nome`, `descricao?`) e `UpdateTurmaDto` (`nome?`, `descricao?`, `ativa?`). (Booleanos com o padrão `@Transform` anti-coerção.)
- [x] `MatricularDto` (`codigoConvite`, com normalização trim+uppercase).
- [x] `UpdateMatriculaDto` (`status`).
- [x] `VincularPlanoDto` (`planoId`).

### Service
- [x] `TurmasService.create` — geração de `codigo_convite` único com retry. (8 chars, alfabeto sem 0/O/1/I/L, `crypto.randomInt`.)
- [x] `TurmasService.list` (escopo por dono / interno), `getById` (com checagem de dono ou matrícula ativa), `update`, `regenerarCodigo`, `softDelete`. (`codigoConvite` omitido nas respostas para aluno.)
- [x] `MatriculasService.matricular` — resolução por código, turma ativa, upsert/reativação, unique. (201 criação / 200 reativação; corrida P2002 → 409; throttle 10/min.)
- [x] `MatriculasService.listByTurma` (paginado, join com User), `listMe` (paginado), `updateStatus` (dono ou próprio aluno). (Review: aluno só pode `INATIVA` — auto-readmissão via PATCH → 403; readmitir-se exige código vigente via POST.)
- [x] `TurmaPlanosService.vincular` — validar `Plano` OFICIAL + publicado (`422`), unique (`409`).
- [x] `TurmaPlanosService.listByTurma`, `desvincular`. (Aluno não vê plano despublicado após o vínculo; gestor vê.)

### Controller
- [x] `TurmasController` (`/turmas`, `/turmas/{id}`, `/turmas/{id}/regenerar-codigo`).
- [x] `MatriculasController` (`/matriculas`, `/matriculas/me`, `/turmas/{id}/matriculas`, `/matriculas/{id}`).
- [x] `TurmaPlanosController` (`/turmas/{id}/planos`, `/turmas/{id}/planos/{planoId}`).
- [x] Aplicar `RolesGuard` (interno vs `ALUNO`) e verificação de dono/escopo por rota. (`TurmasAccessService`; ADMIN/MODERADOR ignoram checagem de dono.)

## Frontend (Angular)

### Telas / Componentes
- [x] Lista de turmas do professor + criar/editar turma (form nome/descrição/ativa).
- [x] Detalhe da turma exibindo `codigoConvite` e botão "regenerar código". (Com copiar + confirmação.)
- [x] Lista de alunos matriculados com filtro de status e ação ativar/inativar.
- [x] Painel de planos vinculados à turma (vincular por seleção de plano OFICIAL, desvincular).
- [x] Tela do aluno "entrar em turma" (input de código de convite). (Uppercase automático; mensagens 404/409.)
- [x] Lista das turmas do aluno + planos oficiais da turma. (Rota `/minhas-turmas`; expansão inline de planos; sair da turma.)

### Serviços
- [x] `TurmasService` (CRUD, regenerar código).
- [x] `MatriculasService` (matricular por código, listar por turma, listar minhas, alterar status).
- [x] `TurmaPlanosService` (vincular, listar, desvincular).

### Guards
- [x] Reuso do `authGuard` e `roleGuard` de [auth-e-usuarios](../auth-e-usuarios/tasks.md); rotas de gestão de turma exigem role interna, "entrar em turma" exige `ALUNO`.

## Testes
- [x] Unit (service): criação com código único, matrícula duplicada (409), reativação de matrícula inativa, turma inativa (409), vínculo de plano não-OFICIAL/não-publicado (422), vínculo duplicado (409).
- [x] Unit: escopo de acesso (professor não-dono → 403; aluno sem matrícula ativa → 403). (+ regressões: auto-readmissão 403, filtro `publicado` para aluno.)
- [x] Integração/e2e: criar turma → aluno matricula por código → professor lista alunos → vincula plano → aluno lista planos. (+ corrida de matrícula, soft delete de turma, e2e de código regenerado.)
- [x] Integração: `ALUNO` bloqueado ao criar turma (403); interno bloqueado ao usar rota de matrícula por código.

> Pendências registradas: matrículas de usuário soft-deleted seguem listadas (tratar no fluxo de exclusão de conta da feature users); aperto do `PlanosAccessService` por matrícula/`AlunoPlanoAtivo` continua futuro; dropdowns com `pageSize: 100` sem paginação (dívida compartilhada); exclusão de turma sem botão na UI (API pronta).

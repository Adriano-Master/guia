# Turmas — Requirements

**Fase: [MVP]**

## Objetivo

Permitir que um **professor** (usuário interno) crie e gerencie **turmas**, gere um **código de convite**, e que **alunos** se matriculem por esse código. Suportar listagem de alunos de uma turma, controle de **status de matrícula** e vínculo de **planos OFICIAIS** à turma (`TurmaPlano`), para que os alunos matriculados enxerguem os planos oficiais associados.

## Personas

Ver [visão de produto](../../00-visao-produto.md#3-personas). Envolvidas: **Professor** (interno, dono da turma), **Aluno** (externo, matriculado), **Admin/Moderador** (podem moderar turmas).

## User stories

- Como **professor**, quero criar uma turma com nome e descrição, para agrupar meus alunos.
- Como **professor**, quero que a turma tenha um código de convite único, para compartilhar com os alunos.
- Como **professor**, quero regenerar o código de convite, para revogar convites antigos quando necessário.
- Como **professor**, quero ativar/desativar a turma, para controlar novas matrículas.
- Como **aluno**, quero me matricular em uma turma informando o código de convite, para acompanhar o conteúdo da turma.
- Como **professor**, quero listar os alunos matriculados na minha turma, para acompanhar quem está participando.
- Como **professor**, quero alterar o status de uma matrícula (ativar/inativar), para remover ou readmitir um aluno.
- Como **aluno**, quero sair de uma turma (inativar minha matrícula), para deixar de acompanhá-la.
- Como **professor**, quero vincular um ou mais planos OFICIAIS à turma, para que os alunos matriculados sigam esses planos.
- Como **professor**, quero desvincular um plano da turma, para atualizar o conteúdo oferecido.
- Como **aluno matriculado**, quero listar os planos oficiais da turma, para escolher qual seguir.

## Critérios de aceitação

- [ ] `POST /api/v1/turmas` cria `Turma` com `professor_id` = usuário autenticado (role interna), `codigo_convite` único gerado pelo service e `ativa = true`.
- [ ] Apenas usuários internos (`PROFESSOR`/`MODERADOR`/`ADMIN`) criam turma; `ALUNO` recebe `403 FORBIDDEN`.
- [ ] `codigo_convite` é único no banco; colisão na geração é reprocessada até obter valor livre.
- [ ] `GET /api/v1/turmas` lista as turmas do professor autenticado (paginado); `ADMIN`/`MODERADOR` podem listar todas.
- [ ] `GET /api/v1/turmas/{id}` retorna a turma; professor só acessa as suas → acesso cruzado por outro professor retorna `403`.
- [ ] `POST /api/v1/turmas/{id}/regenerar-codigo` gera novo `codigo_convite` (só o professor dono / interno).
- [ ] `POST /api/v1/matriculas` (ou `/turmas/{id}/matriculas`) matricula o aluno autenticado via `codigoConvite`; cria `Matricula` com `status = ATIVA`.
- [ ] Matrícula em turma inexistente/código inválido → `404 NOT_FOUND`; em turma `ativa = false` → `409 CONFLICT`.
- [ ] Matrícula duplicada (mesmo `aluno_id` + `turma_id`) é bloqueada pelo unique `(turma_id, aluno_id)` → `409 CONFLICT`.
- [ ] `GET /api/v1/turmas/{id}/matriculas` lista os alunos matriculados (paginado); só o professor dono / interno.
- [ ] `PATCH /api/v1/matriculas/{id}` altera `status` (`ATIVA`/`INATIVA`); professor dono ou o próprio aluno (para sair).
- [ ] `POST /api/v1/turmas/{id}/planos` vincula um `Plano` **OFICIAL e publicado** à turma criando `TurmaPlano`; plano `PESSOAL` ou não publicado → `422 VALIDATION_ERROR`.
- [ ] Vínculo duplicado (mesmo `turma_id` + `plano_id`) → `409 CONFLICT` (unique `(turma_id, plano_id)`).
- [ ] `DELETE /api/v1/turmas/{id}/planos/{planoId}` remove o `TurmaPlano` → `204`.
- [ ] `GET /api/v1/turmas/{id}/planos` lista planos oficiais vinculados; aluno matriculado ativo também pode listar.
- [ ] Erros seguem o [envelope padrão](../../01-arquitetura/api-conventions.md#5-formato-de-erro-padrão); listagens seguem [paginação](../../01-arquitetura/api-conventions.md#4-paginação-filtro-ordenação).

## Regras de negócio

- **RN-01 — Dono da turma.** `professor_id` é sempre um usuário **interno**; o dono é quem criou. Só o dono (ou `ADMIN`/`MODERADOR`) gerencia turma, matrículas e vínculos de plano.
- **RN-02 — Código de convite.** `codigo_convite` é único e o mecanismo de matrícula. Regenerar invalida o código anterior (convites antigos deixam de funcionar); matrículas já feitas permanecem.
- **RN-03 — Matrícula.** `Matricula` é o vínculo N:N `Aluno↔Turma` com unique `(turma_id, aluno_id)`. `status ∈ {ATIVA, INATIVA}`. Rematrícula reativa a matrícula existente em vez de criar outra.
- **RN-04 — Quem matricula.** Só `ALUNO` se matricula (via código). Usuário interno não se matricula como aluno.
- **RN-05 — Turma inativa.** `ativa = false` bloqueia novas matrículas, mas mantém as existentes e a listagem.
- **RN-06 — Vínculo de plano.** `TurmaPlano` só aceita `Plano` com `tipo = OFICIAL` e `publicado = true`. Planos `PESSOAL` nunca são vinculados a turma.
- **RN-07 — Escopo de acesso.** Aluno só enxerga turmas/planos das turmas em que tem `Matricula` `ATIVA`. Acesso cruzado → `403`.
- **RN-08 — Soft delete.** Remoção de turma/matrícula segue soft delete (convenção do [data-model](../../01-arquitetura/data-model.md)); histórico é preservado.

## Casos de borda

- Matrícula concorrente com o mesmo aluno/turma → uma vence, outra recebe `409` (unique).
- Aluno já matriculado com `status = INATIVA` reenvia código → matrícula é **reativada** (`status = ATIVA`), não duplicada.
- Regenerar código enquanto um aluno digita o antigo → matrícula com código antigo falha (`404`).
- Vincular plano de outro autor: permitido se `OFICIAL` e `publicado`; regra é sobre tipo/publicação, não autoria.
- Vincular plano `OFICIAL` ainda não publicado → `422`.
- Professor tenta listar matrículas de turma que não é sua → `403`.
- Aluno tenta acessar planos de turma sem matrícula ativa → `403`.
- Desvincular plano já removido → `404`.

## Dependências

- Fonte de entidades: [../../01-arquitetura/data-model.md](../../01-arquitetura/data-model.md) — `Turma`, `Matricula`, `TurmaPlano`, `Plano`, `User`.
- Convenções de API/JWT/erro: [../../01-arquitetura/api-conventions.md](../../01-arquitetura/api-conventions.md).
- Autenticação, roles e guards (interno vs externo): [../auth-e-usuarios/requirements.md](../auth-e-usuarios/requirements.md).
- Planos OFICIAIS vinculáveis: [../plano-de-estudo/requirements.md](../plano-de-estudo/requirements.md).
- Origem `HOTMART` pode provisionar matrículas automaticamente (Fase 2): [../integracao-hotmart/requirements.md](../integracao-hotmart/requirements.md).

# Plano de Estudo — Requisitos

**Fase: [MVP]**

## Objetivo

Permitir a estruturação hierárquica de conteúdo de estudo (**Disciplina → Tema → Subtema**, ex.: *Português > Colocação pronominal > Mesóclise*) e a atribuição de **peso percentual por disciplina** dentro de um plano. Suportar dois tipos de plano — **OFICIAL** (criado por usuário interno) e **PESSOAL** (criado por aluno) — e a **derivação** de um plano PESSOAL a partir de um OFICIAL, por **cópia** integral do conteúdo, garantindo que edições do aluno não afetem o plano oficial.

Este é o núcleo de conteúdo que alimenta [cronograma-e-calendario](../cronograma-e-calendario/requirements.md), [progresso](../progresso/requirements.md) e [questoes-e-desempenho](../questoes-e-desempenho/requirements.md).

## User stories

- **US-01** — Como **professor** (interno), quero criar um plano OFICIAL com disciplinas, temas e subtemas, para disponibilizá-lo às turmas.
- **US-02** — Como **professor**, quero definir o peso percentual de cada disciplina no plano, para orientar a distribuição de tempo no cronograma.
- **US-03** — Como **professor**, quero **publicar** um plano OFICIAL, para que ele fique visível às turmas vinculadas.
- **US-04** — Como **aluno**, quero **derivar** um plano PESSOAL a partir de um OFICIAL publicado, para poder personalizá-lo sem alterar o oficial.
- **US-05** — Como **aluno**, quero criar um plano PESSOAL do zero, para organizar meus próprios estudos.
- **US-06** — Como **autor de um plano** (professor no oficial, aluno no pessoal), quero adicionar, editar, reordenar e remover disciplinas, temas e subtemas, para manter a estrutura atualizada.
- **US-07** — Como **autor de um plano**, quero ajustar os pesos das disciplinas com validação de que a soma seja 100%, para manter o plano consistente.

## Critérios de aceitação (testáveis)

- **CA-01** — Criar um `Plano` com `tipo=OFICIAL` só é permitido a usuário interno (`ADMIN`, `MODERADOR`, `PROFESSOR`); tentativa por `ALUNO` retorna `403 FORBIDDEN`.
- **CA-02** — Criar um `Plano` com `tipo=PESSOAL` define `autor_id` = usuário autenticado; aluno só cria plano PESSOAL.
- **CA-03** — Ao salvar/publicar pesos, se `Σ peso_percentual` das disciplinas do plano ≠ 100 (tolerância 0,00), a operação retorna `422 VALIDATION_ERROR` com `details[].field = "pesoPercentual"` e `issue = "soma deve ser 100"`.
- **CA-04** — Cada disciplina do plano tem no máximo **um** `PesoDisciplina` (unique `(plano_id, disciplina_id)`); tentativa de peso duplicado retorna `409 CONFLICT`.
- **CA-05** — Publicar (`publicado=true`) um plano OFICIAL exige que `Σ pesos = 100` e que exista ≥ 1 disciplina; caso contrário `422`.
- **CA-06** — Derivar um plano PESSOAL a partir de um OFICIAL cria um novo `Plano` com `tipo=PESSOAL`, `plano_origem_id` = id do oficial, `autor_id` = aluno, e **cópias** de todas as Disciplinas, Temas, Subtemas e PesosDisciplina, com **novos ids**.
- **CA-07** — Após a derivação, editar/remover qualquer Disciplina/Tema/Subtema/Peso do plano PESSOAL **não** altera nenhum registro do plano OFICIAL de origem (verificado comparando os registros do oficial antes/depois).
- **CA-08** — Só é possível derivar de um plano OFICIAL com `publicado=true`; derivar de plano não publicado ou de plano PESSOAL retorna `422`.
- **CA-09** — A soma dos pesos copiados no plano derivado é idêntica à do oficial (= 100).
- **CA-10** — Criar Tema exige Disciplina existente no mesmo plano; criar Subtema exige Tema existente. Referência inexistente retorna `404 NOT_FOUND`.
- **CA-11** — Remover um Plano remove em cascata suas Disciplinas/Temas/Subtemas/Pesos (soft delete conforme convenção global).
- **CA-12** — Um aluno não pode editar um plano OFICIAL nem um plano PESSOAL de outro aluno; acesso cruzado retorna `403`.

## Regras de negócio

- **RN-01 — Tipos de plano.** `OFICIAL` é criado apenas por usuário interno; `PESSOAL` apenas por aluno. O campo `tipo` é imutável após a criação.
- **RN-02 — Invariante de pesos.** Para todo plano, `Σ PesoDisciplina.peso_percentual = 100`. Validada no **service** (não no ORM) e refletida como `422` com `details`. Cada `peso_percentual ∈ [0, 100]`.
- **RN-03 — Derivação por cópia (deep copy).** Derivar de um OFICIAL cria um PESSOAL independente: copia-se toda a árvore Disciplina→Tema→Subtema e os PesosDisciplina, gerando novos ids e remapeando as FKs internas para os ids copiados. `plano_origem_id` guarda a rastreabilidade da origem, mas **não** cria vínculo de sincronização.
- **RN-04 — Isolamento pós-derivação.** Nenhuma edição no plano derivado propaga para o oficial e vice-versa. Não há "atualizar a partir da origem" no MVP.
- **RN-05 — Publicação.** Apenas OFICIAL possui semântica de `publicado`. Publicar valida pesos = 100 e presença de conteúdo. Plano PESSOAL ignora o campo `publicado`.
- **RN-06 — Autoria e escopo.** `autor_id` identifica o dono. Edições no plano são restritas ao autor (PESSOAL) ou a usuário interno (OFICIAL).
- **RN-07 — Ordenação.** Disciplina, Tema e Subtema têm `ordem` (int) para exibição; a reordenação atualiza apenas esse campo.

## Casos de borda

- **CB-01** — Plano OFICIAL sem disciplinas: não pode ser publicado (`422`).
- **CB-02** — Soma de pesos = 99,99 ou 100,01 por arredondamento: rejeitada (`422`); a validação usa `numeric(5,2)` e exige igualdade exata a 100,00.
- **CB-03** — Derivar duas vezes o mesmo OFICIAL: permitido; gera dois planos PESSOAIS independentes.
- **CB-04** — Remover uma disciplina que possui peso: o `PesoDisciplina` associado também é removido, e a soma dos pesos restantes deixa de ser 100 → plano fica "inconsistente" e não pode ser publicado/derivado até rebalancear.
- **CB-05** — Aluno tenta derivar de plano OFICIAL não publicado: `422`.
- **CB-06** — Adicionar peso a disciplina que já tem peso: `409 CONFLICT`.
- **CB-07** — Plano PESSOAL referenciado por um cronograma ativo sendo editado: edição permitida; a repercussão no cronograma é tratada em [cronograma-e-calendario](../cronograma-e-calendario/requirements.md).

## Dependências

- [00-visao-produto.md](../../00-visao-produto.md) — escopo MVP.
- [01-arquitetura/data-model.md](../../01-arquitetura/data-model.md) — entidades `Plano`, `Disciplina`, `Tema`, `Subtema`, `PesoDisciplina`.
- [01-arquitetura/api-conventions.md](../../01-arquitetura/api-conventions.md) — convenções REST, erros, autorização.
- [auth-e-usuarios](../auth-e-usuarios/requirements.md) — papéis interno/externo e escopo por usuário.
- [turmas](../turmas/requirements.md) — vínculo `TurmaPlano` de plano OFICIAL a turmas.
- [design.md](design.md) · [tasks.md](tasks.md)

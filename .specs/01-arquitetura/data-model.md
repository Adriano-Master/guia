# Modelo de Dados (Global)

> **Fonte única de entidades.** Toda entidade citada em qualquer `design.md` de feature DEVE existir aqui. Nomes de tabela em `snake_case` plural; entidades em `PascalCase`. Todas as tabelas têm `id` (UUID v4, PK), `created_at`, `updated_at`. Exclusões são **soft delete** (`deleted_at` nulo = ativo) salvo indicação contrária.

## 1. ERD (texto)

```
User ──< Matricula >── Turma
User (professor) ──< Plano
Turma ──< TurmaPlano >── Plano

Plano ──< Disciplina ──< Tema ──< Subtema
Plano ──< PesoDisciplina >── Disciplina        (peso % da disciplina no plano)

User ──1:1── AlunoPlanoAtivo ──> Plano          (plano que o aluno segue; pode ser cópia)
User ──< Cronograma ──> Plano
Cronograma ──< BlocoCronograma ──> Disciplina
BlocoCronograma ──0..1── Subtema                 (subtema sugerido para o bloco)

User ──< SessaoEstudo ──> Disciplina (──0..1 Subtema)
User ──< ProgressoSubtema >── Subtema
User ──< RegistroQuestoes ──> Tema (──0..1 Subtema)

User ──< PontuacaoAluno (agregado p/ ranking, Fase 2)
User ──1:1── HotmartAccess (Fase 2)
```

## 2. Entidades núcleo

### User
Usuário único da plataforma (interno ou externo).
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| nome | text | |
| email | citext | único |
| senha_hash | text | bcrypt/argon2; nulo se só-Hotmart sem senha ainda |
| role | enum | `ADMIN` \| `MODERADOR` \| `PROFESSOR` \| `ALUNO` |
| status | enum | `ATIVO` \| `INATIVO` \| `PENDENTE` |
| origem | enum | `PROPRIO` \| `HOTMART` |
| ultimo_login_at | timestamptz | |

> `role ∈ {ADMIN, MODERADOR, PROFESSOR}` = usuário **interno**; `ALUNO` = **externo**.

### Turma
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| nome | text | |
| descricao | text | |
| professor_id | uuid | FK → User (interno) |
| codigo_convite | text | único; usado para matrícula |
| ativa | bool | |

### Matricula
Vínculo aluno↔turma (N:N).
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| turma_id | uuid | FK → Turma |
| aluno_id | uuid | FK → User (ALUNO) |
| status | enum | `ATIVA` \| `INATIVA` |
| **unique** | | (turma_id, aluno_id) |

## 3. Conteúdo do plano de estudo

### Plano
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| titulo | text | |
| descricao | text | |
| tipo | enum | `OFICIAL` (criado por interno) \| `PESSOAL` (criado por aluno) |
| autor_id | uuid | FK → User |
| plano_origem_id | uuid? | FK → Plano; se PESSOAL derivado de um OFICIAL (cópia) |
| publicado | bool | OFICIAL visível para turmas |

> **Regra de derivação:** quando um aluno "cria o próprio a partir do sugerido", cria-se um `Plano` `PESSOAL` com `plano_origem_id` apontando ao oficial e **cópia** de Disciplinas/Temas/Subtemas/Pesos, para que edições do aluno não afetem o oficial. Ver [plano-de-estudo/design.md](../02-features/plano-de-estudo/design.md).

### AlunoPlanoAtivo
Qual plano o aluno está seguindo no momento (1:1). Define o universo de subtemas para progresso e estatísticas e o plano-base do cronograma. Um aluno pode seguir um plano OFICIAL diretamente ou um PESSOAL derivado.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| aluno_id | uuid | FK → User; **unique** (1:1) |
| plano_id | uuid | FK → Plano (OFICIAL seguido ou PESSOAL do aluno) |
| definido_em | timestamptz | quando passou a seguir este plano |

> Trocar o plano ativo altera o denominador de progresso/estatísticas ([estatisticas RN-02](../02-features/estatisticas/requirements.md)). O `Cronograma` ativo referencia o mesmo `plano_id`.

### TurmaPlano
Vincula plano OFICIAL a turma (N:N).
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| turma_id | uuid | FK → Turma |
| plano_id | uuid | FK → Plano (OFICIAL) |
| **unique** | | (turma_id, plano_id) |

### Disciplina
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| plano_id | uuid | FK → Plano |
| nome | text | ex.: "Português" |
| ordem | int | ordenação exibida |

### Tema
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| disciplina_id | uuid | FK → Disciplina |
| nome | text | ex.: "Colocação pronominal" |
| ordem | int | |

### Subtema
Menor unidade de estudo e progresso.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| tema_id | uuid | FK → Tema |
| nome | text | ex.: "Mesóclise" |
| ordem | int | |
| duracao_estimada_min | int? | opcional; alimenta distribuição do cronograma |

### PesoDisciplina
Peso percentual da disciplina dentro do plano.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| plano_id | uuid | FK → Plano |
| disciplina_id | uuid | FK → Disciplina |
| peso_percentual | numeric(5,2) | 0–100 |
| **unique** | | (plano_id, disciplina_id) |
| **invariante** | | Σ peso_percentual por plano = 100 (validado no service) |

## 4. Cronograma

### Cronograma
Instância gerada para um aluno a partir de um plano + disponibilidade.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| aluno_id | uuid | FK → User |
| plano_id | uuid | FK → Plano |
| dias_semana | int[] | 0=Dom … 6=Sáb |
| janelas | jsonb | ex.: `[{dia:1,inicio:"08:00",fim:"10:00"},…]` |
| horas_semana_total | numeric(5,2) | derivado das janelas; redundância p/ validação |
| granularidade_min | int | tamanho do slot (default 30) |
| timezone | text | IANA, ex. `America/Sao_Paulo` |
| ativo | bool | 1 cronograma ativo por aluno |
| gerado_em | timestamptz | |

### BlocoCronograma
Slot concreto no calendário (resultado do algoritmo).
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| cronograma_id | uuid | FK → Cronograma |
| disciplina_id | uuid | FK → Disciplina |
| subtema_id | uuid? | próximo subtema não concluído sugerido |
| inicio | timestamptz | |
| fim | timestamptz | |
| duracao_min | int | |
| status | enum | `PLANEJADO` \| `CONCLUIDO` \| `PULADO` |

## 5. Execução do estudo

### SessaoEstudo
Registro de tempo estudado (cronômetro ou manual).
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| aluno_id | uuid | FK → User |
| disciplina_id | uuid | FK → Disciplina |
| subtema_id | uuid? | FK → Subtema |
| bloco_id | uuid? | FK → BlocoCronograma (se originada do calendário) |
| origem | enum | `CRONOMETRO` \| `MANUAL` |
| inicio | timestamptz | |
| fim | timestamptz? | nulo enquanto cronômetro corre |
| duracao_min | int | calculado no fim (ou informado se manual) |

### ProgressoSubtema
Estado de conclusão por aluno×subtema.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| aluno_id | uuid | FK → User |
| subtema_id | uuid | FK → Subtema |
| concluido | bool | |
| concluido_em | timestamptz? | |
| **unique** | | (aluno_id, subtema_id) |

### RegistroQuestoes
Questões resolvidas e erros por tema/subtema.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| aluno_id | uuid | FK → User |
| tema_id | uuid | FK → Tema |
| subtema_id | uuid? | FK → Subtema |
| data | date | |
| total | int | questões resolvidas |
| erros | int | ≤ total |
| **derivado** | | taxa_erro = erros/total (calculado, não armazenado) |

## 6. Gamificação (Fase 2)

### PontuacaoAluno
Agregado para ranking (materializado/atualizado por job ou trigger).
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| aluno_id | uuid | FK → User; unique |
| pontos | int | fórmula em [gamificacao design](../02-features/gamificacao-ranking/design.md) |
| subtemas_concluidos | int | |
| horas_estudadas | numeric | |
| atualizado_em | timestamptz | |

## 7. Integração Hotmart (Fase 2)

### HotmartAccess
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → User; unique |
| transacao_hotmart | text | id da transação |
| produto_hotmart | text | mapeia p/ turma/plano concedido |
| status | enum | `ATIVO` \| `REVOGADO` |
| evento_ultimo | text | último evento processado |
| atualizado_em | timestamptz | |

### HotmartWebhookEvent
Log idempotente de eventos recebidos.
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| evento_id | text | id do evento Hotmart; **unique** (idempotência) |
| tipo | text | `PURCHASE_APPROVED`, `PURCHASE_REFUNDED`, … |
| payload | jsonb | corpo bruto |
| processado_em | timestamptz? | |

## 8. Índices e integridade (destaques)

- FKs com `ON DELETE` conforme regra (ex.: apagar Plano → cascade em Disciplina/Tema/Subtema).
- Índices em: `SessaoEstudo(aluno_id, inicio)`, `BlocoCronograma(cronograma_id, inicio)`, `RegistroQuestoes(aluno_id, tema_id, data)`, `ProgressoSubtema(aluno_id, subtema_id)`.
- Uniques listados nas tabelas garantem não-duplicação (matrícula, peso, progresso).

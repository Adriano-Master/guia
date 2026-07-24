// Seed idempotente — cria/atualiza:
//   1. o usuário ADMIN inicial (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD);
//   2. um usuário PROFESSOR de dev (professor@guia.local, mesma senha);
//   3. um plano OFICIAL publicado de exemplo com disciplinas/temas/subtemas e
//      pesos somando 100.00 (chave natural: titulo + autor);
//   4. um bloco de DADOS DE DEMONSTRAÇÃO (professora, planos PF/TRT, turmas,
//      12 alunos, cronogramas, sessões, progresso e registros de questões) —
//      pulado quando NODE_ENV === 'production'.
import { config as loadEnv } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// .env local do backend ou .env da raiz do repositório (dev fora do Docker).
loadEnv({ path: '.env' });
loadEnv({ path: '../.env' });

const prisma = new PrismaClient();

const PROFESSOR_EMAIL = 'professor@guia.local';
const PLANO_EXEMPLO_TITULO = 'Plano de Exemplo — Concurso';

interface SubtemaSeed {
  nome: string;
  ordem: number;
  duracaoEstimadaMin?: number;
}

interface TemaSeed {
  nome: string;
  ordem: number;
  subtemas: SubtemaSeed[];
}

interface DisciplinaSeed {
  nome: string;
  ordem: number;
  pesoPercentual: string;
  temas: TemaSeed[];
}

const DISCIPLINAS_EXEMPLO: DisciplinaSeed[] = [
  {
    nome: 'Português',
    ordem: 0,
    pesoPercentual: '40.00',
    temas: [
      {
        nome: 'Colocação pronominal',
        ordem: 0,
        subtemas: [
          { nome: 'Próclise', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Mesóclise', ordem: 1, duracaoEstimadaMin: 45 },
          { nome: 'Ênclise', ordem: 2, duracaoEstimadaMin: 45 },
        ],
      },
      {
        nome: 'Concordância verbal',
        ordem: 1,
        subtemas: [{ nome: 'Regras gerais', ordem: 0, duracaoEstimadaMin: 90 }],
      },
    ],
  },
  {
    nome: 'Direito Constitucional',
    ordem: 1,
    pesoPercentual: '35.00',
    temas: [
      {
        nome: 'Direitos fundamentais',
        ordem: 0,
        subtemas: [
          { nome: 'Direitos individuais', ordem: 0, duracaoEstimadaMin: 120 },
          { nome: 'Remédios constitucionais', ordem: 1, duracaoEstimadaMin: 90 },
        ],
      },
    ],
  },
  {
    nome: 'Raciocínio Lógico',
    ordem: 2,
    pesoPercentual: '25.00',
    temas: [
      {
        nome: 'Proposições',
        ordem: 0,
        subtemas: [{ nome: 'Tabelas-verdade', ordem: 0, duracaoEstimadaMin: 60 }],
      },
    ],
  },
];

async function seedAdmin(senhaHash: string, email: string): Promise<void> {
  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: 'ADMIN',
      status: 'ATIVO',
      senhaHash,
      deletedAt: null,
    },
    create: {
      nome: 'Administrador',
      email,
      senhaHash,
      role: 'ADMIN',
      status: 'ATIVO',
      origem: 'PROPRIO',
    },
  });
  console.log(`Admin seed ok: ${admin.email} (id=${admin.id})`);
}

async function seedProfessor(senhaHash: string): Promise<string> {
  const professor = await prisma.user.upsert({
    where: { email: PROFESSOR_EMAIL },
    update: {
      role: 'PROFESSOR',
      status: 'ATIVO',
      senhaHash,
      deletedAt: null,
    },
    create: {
      nome: 'Professor de Exemplo',
      email: PROFESSOR_EMAIL,
      senhaHash,
      role: 'PROFESSOR',
      status: 'ATIVO',
      origem: 'PROPRIO',
    },
  });
  console.log(`Professor seed ok: ${professor.email} (id=${professor.id})`);
  return professor.id;
}

// Chave natural titulo+autor (sem unique no schema → findFirst + create).
// Retorna o id do plano (existente ou recém-criado).
async function ensurePlanoOficial(
  titulo: string,
  descricao: string,
  autorId: string,
  disciplinas: DisciplinaSeed[],
): Promise<string> {
  const existente = await prisma.plano.findFirst({
    where: { titulo, autorId, deletedAt: null },
  });
  if (existente) {
    console.log(`Plano "${titulo}" já existe (id=${existente.id}) — seed ignorado.`);
    return existente.id;
  }

  const plano = await prisma.$transaction(async (tx) => {
    const novo = await tx.plano.create({
      data: {
        titulo,
        descricao,
        tipo: 'OFICIAL',
        autorId,
        publicado: true,
      },
    });

    for (const disciplinaSeed of disciplinas) {
      const disciplina = await tx.disciplina.create({
        data: { planoId: novo.id, nome: disciplinaSeed.nome, ordem: disciplinaSeed.ordem },
      });

      for (const temaSeed of disciplinaSeed.temas) {
        const tema = await tx.tema.create({
          data: { disciplinaId: disciplina.id, nome: temaSeed.nome, ordem: temaSeed.ordem },
        });
        await tx.subtema.createMany({
          data: temaSeed.subtemas.map((s) => ({
            temaId: tema.id,
            nome: s.nome,
            ordem: s.ordem,
            duracaoEstimadaMin: s.duracaoEstimadaMin ?? null,
          })),
        });
      }

      await tx.pesoDisciplina.create({
        data: {
          planoId: novo.id,
          disciplinaId: disciplina.id,
          pesoPercentual: new Prisma.Decimal(disciplinaSeed.pesoPercentual),
        },
      });
    }

    return novo;
  });

  console.log(`Plano seed ok: "${plano.titulo}" (id=${plano.id})`);
  return plano.id;
}

// ---------------------------------------------------------------------------
// BLOCO DEMO — dados de demonstração realistas (pt-BR).
//
// Senha de TODOS os usuários demo (professora.clara e aluno01..aluno12):
//   Guia@Demo2026
// (hash argon2id com o mesmo custo/chamada do seed do admin.)
//
// Idempotência:
//   - usuários/planos/turmas/vínculos/matrículas: upsert/find por chave
//     natural (email, titulo+autor, nome+professor, uniques compostos);
//   - dados transacionais dos alunos demo (cronogramas, sessões, progresso,
//     registros de questões): DELETE prévio escopado APENAS aos ids dos
//     alunos demo + recriação determinística ("refresh") — re-rodar o seed
//     nunca duplica nem colide com os índices únicos parciais.
//
// Reprodutibilidade: PRNG determinístico mulberry32(42) — nada de
// Math.random. Datas são relativas a HOJE no fuso America/Sao_Paulo
// (UTC-3 fixo; o Brasil não tem horário de verão desde 2019).
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = 'Guia@Demo2026';
const PROFESSORA_CLARA_EMAIL = 'professora.clara@guia.local';
const PLANO_TRT_TITULO = 'Plano TRT — Analista Judiciário';
const PLANO_PF_TITULO = 'Plano PF — Agente';

// Offset fixo de America/Sao_Paulo (UTC-3, sem DST desde 2019).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, itens: T[]): T {
  return itens[Math.floor(rng() * itens.length)];
}

function shuffle<T>(rng: Rng, itens: T[]): T[] {
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Componentes (ano/mês/dia) da data de HOJE no fuso de São Paulo. */
function hojeSp(): { ano: number; mes: number; dia: number } {
  const agora = new Date(Date.now() - SP_OFFSET_MS);
  return { ano: agora.getUTCFullYear(), mes: agora.getUTCMonth(), dia: agora.getUTCDate() };
}

/** Instante UTC correspondente a (hoje-SP − diasAtras) às hora:minuto locais. */
function spDateTime(diasAtras: number, hora: number, minuto: number): Date {
  const { ano, mes, dia } = hojeSp();
  return new Date(Date.UTC(ano, mes, dia - diasAtras, hora, minuto) + SP_OFFSET_MS);
}

/** Meia-noite UTC da data local (para colunas DATE). */
function spDateOnly(diasAtras: number): Date {
  const { ano, mes, dia } = hojeSp();
  return new Date(Date.UTC(ano, mes, dia - diasAtras));
}

// Perfis de esforço (deterministicamente atribuídos por aluno).
type Perfil = 'CONSISTENTE' | 'MEDIO' | 'LEVE' | 'ZERO';

interface PerfilConfig {
  diasSemanaMin: number;
  diasSemanaMax: number;
  minutosDiaMin: number;
  minutosDiaMax: number;
  progressoMin: number;
  progressoMax: number;
}

const PERFIS: Record<Exclude<Perfil, 'ZERO'>, PerfilConfig> = {
  CONSISTENTE: {
    diasSemanaMin: 5,
    diasSemanaMax: 6,
    minutosDiaMin: 60,
    minutosDiaMax: 180,
    progressoMin: 0.55,
    progressoMax: 0.7,
  },
  MEDIO: {
    diasSemanaMin: 3,
    diasSemanaMax: 4,
    minutosDiaMin: 45,
    minutosDiaMax: 120,
    progressoMin: 0.3,
    progressoMax: 0.5,
  },
  LEVE: {
    diasSemanaMin: 1,
    diasSemanaMax: 2,
    minutosDiaMin: 30,
    minutosDiaMax: 90,
    progressoMin: 0.1,
    progressoMax: 0.25,
  },
};

type PlanoKey = 'PF' | 'TRT' | 'EXEMPLO';

interface AlunoSeed {
  email: string;
  nome: string;
  status: 'ATIVO' | 'INATIVO';
  perfil: Perfil;
  // Turma/plano principal — usado no cronograma e no sorteio de disciplinas.
  planoPrincipal: PlanoKey;
  comCronograma: boolean;
  // aluno01: sessões tardias (23:00–23:30 locais) p/ validar corte de dia
  // nas estatísticas.
  sessoesTardias?: boolean;
}

const ALUNOS_DEMO: AlunoSeed[] = [
  // Consistentes (bônus de semanas no ranking).
  { email: 'aluno01@guia.local', nome: 'Ana Beatriz Souza', status: 'ATIVO', perfil: 'CONSISTENTE', planoPrincipal: 'PF', comCronograma: true, sessoesTardias: true },
  { email: 'aluno02@guia.local', nome: 'Bruno Carvalho', status: 'ATIVO', perfil: 'CONSISTENTE', planoPrincipal: 'PF', comCronograma: true },
  { email: 'aluno06@guia.local', nome: 'Felipe Andrade', status: 'ATIVO', perfil: 'CONSISTENTE', planoPrincipal: 'TRT', comCronograma: true },
  // Médios.
  { email: 'aluno03@guia.local', nome: 'Camila Ferreira', status: 'ATIVO', perfil: 'MEDIO', planoPrincipal: 'PF', comCronograma: true },
  { email: 'aluno04@guia.local', nome: 'Diego Nascimento', status: 'ATIVO', perfil: 'MEDIO', planoPrincipal: 'PF', comCronograma: true },
  { email: 'aluno05@guia.local', nome: 'Elaine Rocha', status: 'ATIVO', perfil: 'MEDIO', planoPrincipal: 'PF', comCronograma: true },
  { email: 'aluno07@guia.local', nome: 'Gabriela Lima', status: 'ATIVO', perfil: 'MEDIO', planoPrincipal: 'TRT', comCronograma: true },
  { email: 'aluno08@guia.local', nome: 'Henrique Barros', status: 'ATIVO', perfil: 'MEDIO', planoPrincipal: 'TRT', comCronograma: true },
  // aluno09: ZERO atividade (fica com 0 no fim do ranking) — tem cronograma,
  // mas sem sessões/progresso/registros.
  { email: 'aluno09@guia.local', nome: 'Isabela Martins', status: 'ATIVO', perfil: 'ZERO', planoPrincipal: 'TRT', comCronograma: true },
  // Leves. aluno10 SEM cronograma (demo do progresso 0 nas estatísticas).
  { email: 'aluno10@guia.local', nome: 'João Pedro Alves', status: 'ATIVO', perfil: 'LEVE', planoPrincipal: 'EXEMPLO', comCronograma: false },
  { email: 'aluno11@guia.local', nome: 'Karina Duarte', status: 'ATIVO', perfil: 'LEVE', planoPrincipal: 'EXEMPLO', comCronograma: true },
  // aluno12 INATIVO (RN-05 do ranking): tem sessões (pontuação preservada),
  // some do ranking; sem cronograma.
  { email: 'aluno12@guia.local', nome: 'Lucas Moreira', status: 'INATIVO', perfil: 'MEDIO', planoPrincipal: 'TRT', comCronograma: false },
];

const DISCIPLINAS_PF: DisciplinaSeed[] = [
  {
    nome: 'Português',
    ordem: 0,
    pesoPercentual: '20.00',
    temas: [
      {
        nome: 'Interpretação de texto',
        ordem: 0,
        subtemas: [
          { nome: 'Ideias principais e secundárias', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Inferência e pressupostos', ordem: 1, duracaoEstimadaMin: 60 },
          { nome: 'Coesão e coerência', ordem: 2, duracaoEstimadaMin: 90 },
        ],
      },
      {
        nome: 'Ortografia e acentuação',
        ordem: 1,
        subtemas: [
          { nome: 'Regras de acentuação', ordem: 0, duracaoEstimadaMin: 45 },
          { nome: 'Emprego do hífen', ordem: 1, duracaoEstimadaMin: 45 },
        ],
      },
    ],
  },
  {
    nome: 'Raciocínio Lógico',
    ordem: 1,
    pesoPercentual: '15.00',
    temas: [
      {
        nome: 'Lógica proposicional',
        ordem: 0,
        subtemas: [
          { nome: 'Conectivos lógicos', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Equivalências lógicas', ordem: 1, duracaoEstimadaMin: 60 },
          { nome: 'Negação de proposições', ordem: 2, duracaoEstimadaMin: 45 },
        ],
      },
      {
        nome: 'Análise combinatória',
        ordem: 1,
        subtemas: [
          { nome: 'Princípio fundamental da contagem', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Permutações e arranjos', ordem: 1, duracaoEstimadaMin: 90 },
        ],
      },
    ],
  },
  {
    nome: 'Direito Constitucional',
    ordem: 2,
    pesoPercentual: '20.00',
    temas: [
      {
        nome: 'Direitos e garantias fundamentais',
        ordem: 0,
        subtemas: [
          { nome: 'Direitos individuais e coletivos', ordem: 0, duracaoEstimadaMin: 120 },
          { nome: 'Remédios constitucionais', ordem: 1, duracaoEstimadaMin: 90 },
        ],
      },
      {
        nome: 'Segurança pública',
        ordem: 1,
        subtemas: [
          { nome: 'Art. 144 da Constituição Federal', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Atribuições da Polícia Federal', ordem: 1, duracaoEstimadaMin: 60 },
        ],
      },
    ],
  },
  {
    nome: 'Direito Administrativo',
    ordem: 3,
    pesoPercentual: '15.00',
    temas: [
      {
        nome: 'Atos administrativos',
        ordem: 0,
        subtemas: [
          { nome: 'Atributos do ato administrativo', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Classificação dos atos', ordem: 1, duracaoEstimadaMin: 60 },
          { nome: 'Extinção dos atos', ordem: 2, duracaoEstimadaMin: 45 },
        ],
      },
      {
        nome: 'Poderes administrativos',
        ordem: 1,
        subtemas: [
          { nome: 'Poder de polícia', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Poder hierárquico e disciplinar', ordem: 1, duracaoEstimadaMin: 45 },
        ],
      },
    ],
  },
  {
    nome: 'Informática',
    ordem: 4,
    pesoPercentual: '30.00',
    temas: [
      {
        nome: 'Redes de computadores',
        ordem: 0,
        subtemas: [
          { nome: 'Protocolos TCP/IP', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Segurança de redes', ordem: 1, duracaoEstimadaMin: 90 },
        ],
      },
      {
        nome: 'Segurança da informação',
        ordem: 1,
        subtemas: [
          { nome: 'Criptografia simétrica e assimétrica', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Malwares e ataques', ordem: 1, duracaoEstimadaMin: 60 },
          { nome: 'Becape e recuperação', ordem: 2, duracaoEstimadaMin: 45 },
        ],
      },
    ],
  },
];

const DISCIPLINAS_TRT: DisciplinaSeed[] = [
  {
    nome: 'Português',
    ordem: 0,
    pesoPercentual: '25.00',
    temas: [
      {
        nome: 'Sintaxe',
        ordem: 0,
        subtemas: [
          { nome: 'Termos da oração', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Período composto', ordem: 1, duracaoEstimadaMin: 90 },
          { nome: 'Pontuação', ordem: 2, duracaoEstimadaMin: 60 },
        ],
      },
      {
        nome: 'Semântica',
        ordem: 1,
        subtemas: [
          { nome: 'Sinonímia e antonímia', ordem: 0, duracaoEstimadaMin: 45 },
          { nome: 'Ambiguidade e polissemia', ordem: 1, duracaoEstimadaMin: 45 },
        ],
      },
    ],
  },
  {
    nome: 'Raciocínio Lógico',
    ordem: 1,
    pesoPercentual: '15.00',
    temas: [
      {
        nome: 'Proposições e argumentos',
        ordem: 0,
        subtemas: [
          { nome: 'Tabelas-verdade', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Validade de argumentos', ordem: 1, duracaoEstimadaMin: 60 },
        ],
      },
      {
        nome: 'Problemas aritméticos',
        ordem: 1,
        subtemas: [
          { nome: 'Razão e proporção', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Porcentagem', ordem: 1, duracaoEstimadaMin: 45 },
        ],
      },
    ],
  },
  {
    nome: 'Direito Constitucional',
    ordem: 2,
    pesoPercentual: '20.00',
    temas: [
      {
        nome: 'Organização do Estado',
        ordem: 0,
        subtemas: [
          { nome: 'União, Estados e Municípios', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Administração pública na CF', ordem: 1, duracaoEstimadaMin: 90 },
        ],
      },
      {
        nome: 'Poder Judiciário',
        ordem: 1,
        subtemas: [
          { nome: 'Organização da Justiça do Trabalho', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Garantias da magistratura', ordem: 1, duracaoEstimadaMin: 60 },
        ],
      },
    ],
  },
  {
    nome: 'Direito Administrativo',
    ordem: 3,
    pesoPercentual: '20.00',
    temas: [
      {
        nome: 'Licitações e contratos',
        ordem: 0,
        subtemas: [
          { nome: 'Lei 14.133/2021 — visão geral', ordem: 0, duracaoEstimadaMin: 120 },
          { nome: 'Modalidades de licitação', ordem: 1, duracaoEstimadaMin: 90 },
          { nome: 'Contratos administrativos', ordem: 2, duracaoEstimadaMin: 90 },
        ],
      },
      {
        nome: 'Agentes públicos',
        ordem: 1,
        subtemas: [
          { nome: 'Regime jurídico dos servidores', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Responsabilidade civil do Estado', ordem: 1, duracaoEstimadaMin: 60 },
        ],
      },
    ],
  },
  {
    nome: 'Direito do Trabalho',
    ordem: 4,
    pesoPercentual: '20.00',
    temas: [
      {
        nome: 'Contrato de trabalho',
        ordem: 0,
        subtemas: [
          { nome: 'Requisitos do vínculo empregatício', ordem: 0, duracaoEstimadaMin: 90 },
          { nome: 'Alteração e suspensão do contrato', ordem: 1, duracaoEstimadaMin: 60 },
          { nome: 'Rescisão contratual', ordem: 2, duracaoEstimadaMin: 90 },
        ],
      },
      {
        nome: 'Jornada de trabalho',
        ordem: 1,
        subtemas: [
          { nome: 'Duração e intervalos', ordem: 0, duracaoEstimadaMin: 60 },
          { nome: 'Horas extras e compensação', ordem: 1, duracaoEstimadaMin: 60 },
        ],
      },
    ],
  },
];

// Códigos de convite FIXOS (idempotência/reprodutibilidade): 8 chars do
// alfabeto do módulo turmas — 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' (sem 0/O/1/I/L).
interface TurmaDemoSeed {
  nome: string;
  descricao: string;
  codigoConvite: string;
  professor: 'PROFESSOR' | 'CLARA';
  plano: PlanoKey;
}

const TURMAS_DEMO: TurmaDemoSeed[] = [
  {
    nome: 'Turma PF 2026 — Manhã',
    descricao: 'Preparação para o concurso de Agente da Polícia Federal, turno da manhã.',
    codigoConvite: 'PF26MNHA',
    professor: 'PROFESSOR',
    plano: 'PF',
  },
  {
    nome: 'Turma TRT — Noturno',
    descricao: 'Preparação para Analista Judiciário do TRT, turno noturno.',
    codigoConvite: 'TRTNQT26',
    professor: 'CLARA',
    plano: 'TRT',
  },
  {
    nome: 'Turma Concursos — Intensivo',
    descricao: 'Revisão intensiva multibanca com o plano de exemplo.',
    codigoConvite: 'NTENSV26',
    professor: 'CLARA',
    plano: 'EXEMPLO',
  },
];

// Matrículas ativas: 5 na PF, 5 na TRT, 4 na Intensivo (aluno01 e aluno06 em
// duas turmas → posições diferentes por turma no ranking); aluno11 tem
// matrícula INATIVA na PF; aluno12 (usuário INATIVO) fica na TRT.
interface MatriculaDemoSeed {
  turma: string;
  aluno: string;
  status: 'ATIVA' | 'INATIVA';
}

const MATRICULAS_DEMO: MatriculaDemoSeed[] = [
  { turma: 'Turma PF 2026 — Manhã', aluno: 'aluno01@guia.local', status: 'ATIVA' },
  { turma: 'Turma PF 2026 — Manhã', aluno: 'aluno02@guia.local', status: 'ATIVA' },
  { turma: 'Turma PF 2026 — Manhã', aluno: 'aluno03@guia.local', status: 'ATIVA' },
  { turma: 'Turma PF 2026 — Manhã', aluno: 'aluno04@guia.local', status: 'ATIVA' },
  { turma: 'Turma PF 2026 — Manhã', aluno: 'aluno05@guia.local', status: 'ATIVA' },
  { turma: 'Turma PF 2026 — Manhã', aluno: 'aluno11@guia.local', status: 'INATIVA' },
  { turma: 'Turma TRT — Noturno', aluno: 'aluno06@guia.local', status: 'ATIVA' },
  { turma: 'Turma TRT — Noturno', aluno: 'aluno07@guia.local', status: 'ATIVA' },
  { turma: 'Turma TRT — Noturno', aluno: 'aluno08@guia.local', status: 'ATIVA' },
  { turma: 'Turma TRT — Noturno', aluno: 'aluno09@guia.local', status: 'ATIVA' },
  { turma: 'Turma TRT — Noturno', aluno: 'aluno12@guia.local', status: 'ATIVA' },
  { turma: 'Turma Concursos — Intensivo', aluno: 'aluno01@guia.local', status: 'ATIVA' },
  { turma: 'Turma Concursos — Intensivo', aluno: 'aluno06@guia.local', status: 'ATIVA' },
  { turma: 'Turma Concursos — Intensivo', aluno: 'aluno10@guia.local', status: 'ATIVA' },
  { turma: 'Turma Concursos — Intensivo', aluno: 'aluno11@guia.local', status: 'ATIVA' },
];

interface JanelaSeed {
  dia: number;
  inicio: string;
  fim: string;
}

const JANELAS_POR_PERFIL: Record<Exclude<Perfil, 'ZERO'>, JanelaSeed[]> = {
  CONSISTENTE: [
    { dia: 1, inicio: '19:00', fim: '22:00' },
    { dia: 2, inicio: '19:00', fim: '22:00' },
    { dia: 3, inicio: '19:00', fim: '22:00' },
    { dia: 4, inicio: '19:00', fim: '22:00' },
    { dia: 5, inicio: '19:00', fim: '22:00' },
    { dia: 6, inicio: '08:00', fim: '12:00' },
  ],
  MEDIO: [
    { dia: 2, inicio: '19:00', fim: '21:00' },
    { dia: 4, inicio: '19:00', fim: '21:00' },
    { dia: 6, inicio: '09:00', fim: '12:00' },
  ],
  LEVE: [
    { dia: 0, inicio: '09:00', fim: '11:00' },
    { dia: 6, inicio: '09:00', fim: '11:00' },
  ],
};

function minutosDeJanelas(janelas: JanelaSeed[]): number {
  return janelas.reduce((soma, j) => {
    const [hi, mi] = j.inicio.split(':').map(Number);
    const [hf, mf] = j.fim.split(':').map(Number);
    return soma + (hf * 60 + mf - (hi * 60 + mi));
  }, 0);
}

interface SubtemaInfo {
  id: string;
  disciplinaId: string;
}

interface TemaInfo {
  id: string;
}

interface PlanoEstrutura {
  id: string;
  disciplinaIds: string[];
  temas: TemaInfo[];
  subtemas: SubtemaInfo[];
  subtemasPorDisciplina: Map<string, string[]>;
}

async function carregarEstruturaPlano(planoId: string): Promise<PlanoEstrutura> {
  const disciplinas = await prisma.disciplina.findMany({
    where: { planoId, deletedAt: null },
    orderBy: { ordem: 'asc' },
    include: {
      temas: {
        where: { deletedAt: null },
        orderBy: { ordem: 'asc' },
        include: {
          subtemas: { where: { deletedAt: null }, orderBy: { ordem: 'asc' } },
        },
      },
    },
  });

  const temas: TemaInfo[] = [];
  const subtemas: SubtemaInfo[] = [];
  const subtemasPorDisciplina = new Map<string, string[]>();
  for (const disciplina of disciplinas) {
    const ids: string[] = [];
    for (const tema of disciplina.temas) {
      temas.push({ id: tema.id });
      for (const subtema of tema.subtemas) {
        subtemas.push({ id: subtema.id, disciplinaId: disciplina.id });
        ids.push(subtema.id);
      }
    }
    subtemasPorDisciplina.set(disciplina.id, ids);
  }

  return {
    id: planoId,
    disciplinaIds: disciplinas.map((d) => d.id),
    temas,
    subtemas,
    subtemasPorDisciplina,
  };
}

async function seedDemo(professorId: string, planoExemploId: string): Promise<void> {
  const senhaHashDemo = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  // 1. Professora Clara.
  const clara = await prisma.user.upsert({
    where: { email: PROFESSORA_CLARA_EMAIL },
    update: { role: 'PROFESSOR', status: 'ATIVO', senhaHash: senhaHashDemo, deletedAt: null },
    create: {
      nome: 'Clara Mendes',
      email: PROFESSORA_CLARA_EMAIL,
      senhaHash: senhaHashDemo,
      role: 'PROFESSOR',
      status: 'ATIVO',
      origem: 'PROPRIO',
    },
  });
  console.log(`Professora demo ok: ${clara.email} (id=${clara.id})`);

  // 2. Planos oficiais publicados (pesos somando 100 cada).
  const planoPfId = await ensurePlanoOficial(
    PLANO_PF_TITULO,
    'Plano oficial para o concurso de Agente da Polícia Federal.',
    professorId,
    DISCIPLINAS_PF,
  );
  const planoTrtId = await ensurePlanoOficial(
    PLANO_TRT_TITULO,
    'Plano oficial para Analista Judiciário dos Tribunais Regionais do Trabalho.',
    clara.id,
    DISCIPLINAS_TRT,
  );

  const planos: Record<PlanoKey, PlanoEstrutura> = {
    PF: await carregarEstruturaPlano(planoPfId),
    TRT: await carregarEstruturaPlano(planoTrtId),
    EXEMPLO: await carregarEstruturaPlano(planoExemploId),
  };

  // 3. Turmas (chave natural nome+professor) + vínculo turma_planos.
  const professorPorChave = { PROFESSOR: professorId, CLARA: clara.id } as const;
  const turmaIdPorNome = new Map<string, string>();
  for (const turmaSeed of TURMAS_DEMO) {
    const profId = professorPorChave[turmaSeed.professor];
    let turma = await prisma.turma.findFirst({
      where: { nome: turmaSeed.nome, professorId: profId, deletedAt: null },
    });
    if (!turma) {
      turma = await prisma.turma.create({
        data: {
          nome: turmaSeed.nome,
          descricao: turmaSeed.descricao,
          professorId: profId,
          codigoConvite: turmaSeed.codigoConvite,
          ativa: true,
        },
      });
    } else if (!turma.ativa) {
      turma = await prisma.turma.update({ where: { id: turma.id }, data: { ativa: true } });
    }
    turmaIdPorNome.set(turmaSeed.nome, turma.id);

    await prisma.turmaPlano.upsert({
      where: { turmaId_planoId: { turmaId: turma.id, planoId: planos[turmaSeed.plano].id } },
      update: {},
      create: { turmaId: turma.id, planoId: planos[turmaSeed.plano].id },
    });
    console.log(`Turma demo ok: "${turma.nome}" (convite=${turma.codigoConvite})`);
  }

  // 4. Alunos.
  const alunoIdPorEmail = new Map<string, string>();
  for (const alunoSeed of ALUNOS_DEMO) {
    const aluno = await prisma.user.upsert({
      where: { email: alunoSeed.email },
      update: {
        nome: alunoSeed.nome,
        role: 'ALUNO',
        status: alunoSeed.status,
        senhaHash: senhaHashDemo,
        deletedAt: null,
      },
      create: {
        nome: alunoSeed.nome,
        email: alunoSeed.email,
        senhaHash: senhaHashDemo,
        role: 'ALUNO',
        status: alunoSeed.status,
        origem: 'PROPRIO',
      },
    });
    alunoIdPorEmail.set(alunoSeed.email, aluno.id);
  }
  console.log(`Alunos demo ok: ${ALUNOS_DEMO.length} (aluno12 INATIVO).`);

  // 5. Matrículas (upsert pelo unique turmaId+alunoId).
  for (const matricula of MATRICULAS_DEMO) {
    const turmaId = turmaIdPorNome.get(matricula.turma)!;
    const alunoId = alunoIdPorEmail.get(matricula.aluno)!;
    await prisma.matricula.upsert({
      where: { turmaId_alunoId: { turmaId, alunoId } },
      update: { status: matricula.status, deletedAt: null },
      create: { turmaId, alunoId, status: matricula.status },
    });
  }
  console.log(`Matrículas demo ok: ${MATRICULAS_DEMO.length} (aluno11 INATIVA na PF).`);

  // Refresh determinístico dos dados transacionais: apaga SOMENTE o que é
  // dos alunos demo e recria. Ordem respeita FKs (sessões podem referenciar
  // blocos; blocos caem por cascade ao deletar cronogramas).
  const demoAlunoIds = [...alunoIdPorEmail.values()];
  await prisma.registroQuestoes.deleteMany({ where: { alunoId: { in: demoAlunoIds } } });
  await prisma.progressoSubtema.deleteMany({ where: { alunoId: { in: demoAlunoIds } } });
  await prisma.sessaoEstudo.deleteMany({ where: { alunoId: { in: demoAlunoIds } } });
  await prisma.cronograma.deleteMany({ where: { alunoId: { in: demoAlunoIds } } });

  const rng = mulberry32(42);

  // 6. Cronogramas ativos (1 por aluno — respeita o índice único parcial,
  // pois todos os cronogramas dos alunos demo acabaram de ser removidos).
  // SEM blocos materializados: a materialização de blocos é responsabilidade
  // do gerador do módulo cronograma e fica fora do escopo do seed.
  let cronogramas = 0;
  for (const alunoSeed of ALUNOS_DEMO) {
    if (!alunoSeed.comCronograma || alunoSeed.status !== 'ATIVO') {
      continue;
    }
    const perfilJanelas = alunoSeed.perfil === 'ZERO' ? 'MEDIO' : alunoSeed.perfil;
    const janelas = JANELAS_POR_PERFIL[perfilJanelas];
    const minutosSemana = minutosDeJanelas(janelas);
    await prisma.cronograma.create({
      data: {
        alunoId: alunoIdPorEmail.get(alunoSeed.email)!,
        planoId: planos[alunoSeed.planoPrincipal].id,
        diasSemana: [...new Set(janelas.map((j) => j.dia))].sort((a, b) => a - b),
        janelas: janelas.map((j) => ({ dia: j.dia, inicio: j.inicio, fim: j.fim })),
        horasSemanaTotal: new Prisma.Decimal(minutosSemana).div(60).toDecimalPlaces(2),
        granularidadeMin: 30,
        timezone: 'America/Sao_Paulo',
        ativo: true,
        geradoEm: spDateTime(38 + randInt(rng, 0, 5), 10, 0),
      },
    });
    cronogramas += 1;
  }
  console.log(`Cronogramas demo ok: ${cronogramas} (aluno10 sem cronograma).`);

  // 7. Sessões de estudo das últimas 6 semanas — todas FINALIZADAS.
  // CRONOMETRO: fim − inicio = duracaoMin + pausa (0–15 min);
  // MANUAL: fim − inicio = duracaoMin.
  const sessoes: Prisma.SessaoEstudoCreateManyInput[] = [];
  for (const alunoSeed of ALUNOS_DEMO) {
    if (alunoSeed.perfil === 'ZERO') {
      continue;
    }
    const alunoId = alunoIdPorEmail.get(alunoSeed.email)!;
    const config = PERFIS[alunoSeed.perfil];
    const plano = planos[alunoSeed.planoPrincipal];
    let indiceDiaEstudo = 0;

    for (let semana = 0; semana < 6; semana += 1) {
      const diasNaSemana = randInt(rng, config.diasSemanaMin, config.diasSemanaMax);
      const offsets = shuffle(rng, [0, 1, 2, 3, 4, 5, 6]).slice(0, diasNaSemana);
      for (const offset of offsets) {
        const diasAtras = semana * 7 + offset;
        const duracaoMin = randInt(rng, config.minutosDiaMin, config.minutosDiaMax);
        const origem: 'CRONOMETRO' | 'MANUAL' = rng() < 0.5 ? 'CRONOMETRO' : 'MANUAL';
        const pausaMin = origem === 'CRONOMETRO' ? randInt(rng, 0, 15) : 0;
        // aluno01: a cada 3 dias de estudo, sessão tardia (23:00–23:30 locais)
        // p/ validar a atribuição de dia nas estatísticas.
        const tardia = alunoSeed.sessoesTardias === true && indiceDiaEstudo % 3 === 0;
        const inicioMinLocal = tardia
          ? 23 * 60 + randInt(rng, 0, 30)
          : Math.floor(randInt(rng, 8 * 60, 20 * 60) / 15) * 15;
        const inicio = spDateTime(
          diasAtras,
          Math.floor(inicioMinLocal / 60),
          inicioMinLocal % 60,
        );
        const fim = new Date(inicio.getTime() + (duracaoMin + pausaMin) * 60 * 1000);
        const disciplinaId = pick(rng, plano.disciplinaIds);
        const subtemasDisciplina = plano.subtemasPorDisciplina.get(disciplinaId) ?? [];
        const subtemaId =
          subtemasDisciplina.length > 0 && rng() < 0.6 ? pick(rng, subtemasDisciplina) : null;
        sessoes.push({ alunoId, disciplinaId, subtemaId, origem, inicio, fim, duracaoMin });
        indiceDiaEstudo += 1;
      }
    }
  }
  await prisma.sessaoEstudo.createMany({ data: sessoes });
  console.log(`Sessões demo ok: ${sessoes.length} (aluno09 sem sessões).`);

  // 8. Progresso de subtemas — só quem tem cronograma e teve atividade;
  // fração concluída proporcional ao perfil de esforço.
  const progressos: Prisma.ProgressoSubtemaCreateManyInput[] = [];
  for (const alunoSeed of ALUNOS_DEMO) {
    if (!alunoSeed.comCronograma || alunoSeed.status !== 'ATIVO' || alunoSeed.perfil === 'ZERO') {
      continue;
    }
    const alunoId = alunoIdPorEmail.get(alunoSeed.email)!;
    const config = PERFIS[alunoSeed.perfil];
    const plano = planos[alunoSeed.planoPrincipal];
    const fracao = config.progressoMin + rng() * (config.progressoMax - config.progressoMin);
    const quantidade = Math.max(1, Math.round(plano.subtemas.length * fracao));
    const escolhidos = shuffle(rng, plano.subtemas).slice(0, quantidade);
    for (const subtema of escolhidos) {
      progressos.push({
        alunoId,
        subtemaId: subtema.id,
        concluido: true,
        concluidoEm: spDateTime(randInt(rng, 1, 35), randInt(rng, 9, 21), 0),
      });
    }
  }
  await prisma.progressoSubtema.createMany({ data: progressos });
  console.log(`Progresso demo ok: ${progressos.length} subtemas concluídos.`);

  // 9. Registros de questões (últimas 4 semanas) — médios e consistentes.
  // Só total/erros: taxa de erro é derivada em leitura (CHECK no banco).
  const registros: Prisma.RegistroQuestoesCreateManyInput[] = [];
  for (const alunoSeed of ALUNOS_DEMO) {
    if (alunoSeed.perfil !== 'MEDIO' && alunoSeed.perfil !== 'CONSISTENTE') {
      continue;
    }
    const alunoId = alunoIdPorEmail.get(alunoSeed.email)!;
    const plano = planos[alunoSeed.planoPrincipal];
    const quantidade = randInt(rng, 3, 10);
    for (let i = 0; i < quantidade; i += 1) {
      const total = randInt(rng, 10, 50);
      const taxaErro = 0.15 + rng() * 0.3;
      registros.push({
        alunoId,
        temaId: pick(rng, plano.temas).id,
        data: spDateOnly(randInt(rng, 0, 27)),
        total,
        erros: Math.min(total, Math.round(total * taxaErro)),
      });
    }
  }
  await prisma.registroQuestoes.createMany({ data: registros });
  console.log(`Registros de questões demo ok: ${registros.length}.`);
}

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD ausentes — seed ignorado.');
    return;
  }

  if (password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD deve ter no mínimo 8 caracteres.');
  }

  const senhaHash = await argon2.hash(password, { type: argon2.argon2id });

  await seedAdmin(senhaHash, email);
  const professorId = await seedProfessor(senhaHash);
  const planoExemploId = await ensurePlanoOficial(
    PLANO_EXEMPLO_TITULO,
    'Plano oficial de exemplo criado pelo seed de desenvolvimento.',
    professorId,
    DISCIPLINAS_EXEMPLO,
  );

  if (process.env.NODE_ENV === 'production') {
    console.log('NODE_ENV=production — bloco de dados demo ignorado.');
    return;
  }
  await seedDemo(professorId, planoExemploId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

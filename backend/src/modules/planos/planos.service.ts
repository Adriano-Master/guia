import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MatriculaStatus, Prisma, PlanoTipo, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PaginatedResponse,
  paginated,
  parseSort,
  toSkipTake,
  toStableOrderBy,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlanoDto } from './dto/create-plano.dto';
import { DerivarPlanoDto } from './dto/derivar-plano.dto';
import { ListPlanosQueryDto } from './dto/list-planos-query.dto';
import { SetPesosDto } from './dto/set-pesos.dto';
import { UpdatePlanoDto } from './dto/update-plano.dto';
import {
  PesoDisciplinaResponse,
  PlanoResponse,
  toPesoDisciplinaResponse,
  toPlanoResponse,
} from './plano-response';
import { isInterno, PlanosAccessService } from './planos-access.service';

const SORTABLE_FIELDS = ['titulo', 'createdAt'];

const CEM = new Prisma.Decimal('100.00');

const TITULO_MAX = 200;

/** Normaliza descrição: trim; vazia/ausente vira null. */
function normalizeDescricao(descricao: string | null | undefined): string | null {
  const trimmed = descricao?.trim();
  return trimmed ? trimmed : null;
}

/** include da árvore completa: disciplinas→temas→subtemas (ativos, por ordem) + pesos. */
const planoTreeInclude = {
  disciplinas: {
    where: { deletedAt: null },
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
  },
  pesos: { where: { deletedAt: null } },
} satisfies Prisma.PlanoInclude;

@Injectable()
export class PlanosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlanosAccessService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreatePlanoDto): Promise<PlanoResponse> {
    // RN-01: OFICIAL só por interno; PESSOAL só por aluno.
    if (dto.tipo === PlanoTipo.OFICIAL && !isInterno(user.role)) {
      throw new ForbiddenException('Apenas usuários internos podem criar planos oficiais.');
    }
    if (dto.tipo === PlanoTipo.PESSOAL && user.role !== Role.ALUNO) {
      throw new ForbiddenException('Apenas alunos podem criar planos pessoais.');
    }

    const plano = await this.prisma.plano.create({
      data: {
        titulo: dto.titulo,
        descricao: normalizeDescricao(dto.descricao),
        tipo: dto.tipo,
        autorId: user.sub,
      },
    });
    return toPlanoResponse(plano);
  }

  async list(
    user: AuthenticatedUser,
    query: ListPlanosQueryDto,
  ): Promise<PaginatedResponse<PlanoResponse>> {
    const sort = parseSort(query.sort, SORTABLE_FIELDS);

    // Escopo (regra definitiva de matrícula): ALUNO vê os próprios planos +
    // OFICIAIS publicados vinculados a turmas não-deletadas em que tem
    // matrícula ATIVA; interno vê tudo. O filtro relacional roda em uma query
    // (EXISTS TurmaPlano ⋈ Turma ⋈ Matricula) e o where é sobre Plano, então
    // um plano vinculado a duas turmas do aluno aparece uma vez só.
    const scope: Prisma.PlanoWhereInput = isInterno(user.role)
      ? {}
      : {
          OR: [
            { autorId: user.sub },
            {
              tipo: PlanoTipo.OFICIAL,
              publicado: true,
              turmas: {
                some: {
                  turma: {
                    deletedAt: null,
                    matriculas: {
                      some: { alunoId: user.sub, status: MatriculaStatus.ATIVA, deletedAt: null },
                    },
                  },
                },
              },
            },
          ],
        };

    const where: Prisma.PlanoWhereInput = {
      deletedAt: null,
      ...scope,
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.publicado !== undefined ? { publicado: query.publicado } : {}),
      ...(query.autorId ? { autorId: query.autorId } : {}),
    };

    const [planos, total] = await this.prisma.$transaction([
      this.prisma.plano.findMany({
        where,
        orderBy: toStableOrderBy(sort, { createdAt: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.plano.count({ where }),
    ]);

    return paginated(planos.map(toPlanoResponse), query, total);
  }

  async getById(user: AuthenticatedUser, id: string): Promise<PlanoResponse> {
    const plano = await this.access.loadPlanoOrThrow(id);
    await this.access.assertCanRead(plano, user);
    return this.getTree(id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePlanoDto): Promise<PlanoResponse> {
    const plano = await this.access.loadPlanoOrThrow(id);
    this.access.assertCanEdit(plano, user);

    const updated = await this.prisma.plano.update({
      where: { id },
      data: {
        ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
        ...(dto.descricao !== undefined ? { descricao: normalizeDescricao(dto.descricao) } : {}),
      },
    });
    return toPlanoResponse(updated);
  }

  /** CA-11: soft delete em cascata da árvore inteira, em transação. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const plano = await this.access.loadPlanoOrThrow(id);
    this.access.assertCanEdit(plano, user);

    const deletedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.subtema.updateMany({
        where: { deletedAt: null, tema: { disciplina: { planoId: id } } },
        data: { deletedAt },
      }),
      this.prisma.tema.updateMany({
        where: { deletedAt: null, disciplina: { planoId: id } },
        data: { deletedAt },
      }),
      this.prisma.disciplina.updateMany({
        where: { deletedAt: null, planoId: id },
        data: { deletedAt },
      }),
      this.prisma.pesoDisciplina.updateMany({
        where: { deletedAt: null, planoId: id },
        data: { deletedAt },
      }),
      this.prisma.plano.update({ where: { id }, data: { deletedAt } }),
    ]);
  }

  async listPesos(user: AuthenticatedUser, planoId: string): Promise<PesoDisciplinaResponse[]> {
    const plano = await this.access.loadPlanoOrThrow(planoId);
    await this.access.assertCanRead(plano, user);

    const pesos = await this.prisma.pesoDisciplina.findMany({
      where: { planoId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return pesos.map(toPesoDisciplinaResponse);
  }

  /**
   * Replace-all atômico dos pesos (DT-02). Os registros substituídos são
   * HARD-deletados dentro da transação (não soft): manter linhas soft-deletadas
   * violaria o unique (plano_id, disciplina_id) em substituições futuras.
   */
  async setPesos(
    user: AuthenticatedUser,
    planoId: string,
    dto: SetPesosDto,
  ): Promise<PesoDisciplinaResponse[]> {
    const plano = await this.access.loadPlanoOrThrow(planoId);
    this.access.assertCanEdit(plano, user);

    // CA-04/CB-06: disciplina duplicada no payload → 409.
    const ids = dto.pesos.map((p) => p.disciplinaId);
    if (new Set(ids).size !== ids.length) {
      throw new ConflictException('Cada disciplina pode ter no máximo um peso.');
    }

    const disciplinas = await this.prisma.disciplina.findMany({
      where: { planoId, deletedAt: null },
      select: { id: true },
    });
    const validas = new Set(disciplinas.map((d) => d.id));
    const invalidas = dto.pesos.filter((p) => !validas.has(p.disciplinaId));
    if (invalidas.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Há disciplinas que não pertencem ao plano.',
        details: invalidas.map((p) => ({
          field: 'disciplinaId',
          issue: `disciplina ${p.disciplinaId} não pertence ao plano`,
        })),
      });
    }

    // RN-02/CB-02: soma exata de 100.00 com Decimal (nunca float).
    const soma = dto.pesos.reduce(
      (acc, p) => acc.plus(new Prisma.Decimal(p.pesoPercentual.toFixed(2))),
      new Prisma.Decimal(0),
    );
    if (!soma.equals(CEM)) {
      throw new UnprocessableEntityException({
        message: 'A soma dos pesos deve ser 100.',
        details: [{ field: 'pesoPercentual', issue: 'soma deve ser 100' }],
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.pesoDisciplina.deleteMany({ where: { planoId } });
      await tx.pesoDisciplina.createMany({
        data: dto.pesos.map((p) => ({
          planoId,
          disciplinaId: p.disciplinaId,
          pesoPercentual: new Prisma.Decimal(p.pesoPercentual.toFixed(2)),
        })),
      });
      return tx.pesoDisciplina.findMany({ where: { planoId }, orderBy: { createdAt: 'asc' } });
    });

    return created.map(toPesoDisciplinaResponse);
  }

  /** CA-05/RN-05: publica um OFICIAL após revalidar conteúdo e pesos. Idempotente. */
  async publicar(user: AuthenticatedUser, id: string): Promise<PlanoResponse> {
    const plano = await this.access.loadPlanoOrThrow(id);
    this.access.assertCanEdit(plano, user);

    if (plano.tipo !== PlanoTipo.OFICIAL) {
      throw new UnprocessableEntityException({
        message: 'Apenas planos oficiais podem ser publicados.',
        details: [{ field: 'tipo', issue: 'plano deve ser OFICIAL' }],
      });
    }

    if (plano.publicado) {
      return toPlanoResponse(plano);
    }

    await this.assertPlanoConsistente(id);

    const updated = await this.prisma.plano.update({ where: { id }, data: { publicado: true } });
    return toPlanoResponse(updated);
  }

  /** CA-06/RN-03 (Fluxo B): deriva um PESSOAL por deep copy em uma única transação. */
  async derivar(user: AuthenticatedUser, origemId: string, dto: DerivarPlanoDto): Promise<PlanoResponse> {
    const origem = await this.access.loadPlanoOrThrow(origemId);

    if (origem.tipo !== PlanoTipo.OFICIAL || !origem.publicado) {
      throw new UnprocessableEntityException({
        message: 'Só é possível derivar de um plano OFICIAL publicado.',
        details: [{ field: 'planoOrigemId', issue: 'plano de origem deve ser OFICIAL e publicado' }],
      });
    }
    // Regra de matrícula: aluno só deriva de OFICIAL legível para ele
    // (vinculado a turma com matrícula ATIVA) — publicado sem vínculo → 403.
    await this.access.assertCanRead(origem, user);

    const novoId = await this.prisma.$transaction(async (tx) => {
      // CB-04: consistência (pesos ≠ 100 após remoções) e leitura da árvore na
      // MESMA transação da cópia — sem corrida entre validação e snapshot.
      await this.assertPlanoConsistente(origemId, tx);

      const tree = await tx.plano.findUniqueOrThrow({
        where: { id: origemId },
        include: planoTreeInclude,
      });

      // UUIDs pré-gerados em memória: o mapa origem→cópia remapeia as FKs
      // internas (DT-01) e a escrita cai para 1 create + 4 createMany, sem
      // N INSERTs sequenciais que estourariam o timeout da transação (P2028).
      const planoId = randomUUID();
      const disciplinaMap = new Map<string, string>();
      const disciplinasData: Prisma.DisciplinaCreateManyInput[] = [];
      const temasData: Prisma.TemaCreateManyInput[] = [];
      const subtemasData: Prisma.SubtemaCreateManyInput[] = [];

      for (const disciplina of tree.disciplinas) {
        const disciplinaId = randomUUID();
        disciplinaMap.set(disciplina.id, disciplinaId);
        disciplinasData.push({
          id: disciplinaId,
          planoId,
          nome: disciplina.nome,
          ordem: disciplina.ordem,
        });

        for (const tema of disciplina.temas) {
          const temaId = randomUUID();
          temasData.push({ id: temaId, disciplinaId, nome: tema.nome, ordem: tema.ordem });

          for (const subtema of tema.subtemas) {
            subtemasData.push({
              temaId,
              nome: subtema.nome,
              ordem: subtema.ordem,
              duracaoEstimadaMin: subtema.duracaoEstimadaMin,
            });
          }
        }
      }

      const pesosData: Prisma.PesoDisciplinaCreateManyInput[] = tree.pesos.map((p) => {
        const disciplinaId = disciplinaMap.get(p.disciplinaId);
        if (!disciplinaId) {
          // Peso órfão (disciplina removida): pular quebraria Σ=100 no
          // derivado, então a derivação é abortada como origem inconsistente.
          throw new UnprocessableEntityException({
            message: 'Plano de origem inconsistente: peso sem disciplina correspondente.',
            details: [
              { field: 'pesos', issue: `peso referencia disciplina ${p.disciplinaId} inexistente no plano` },
            ],
          });
        }
        return { planoId, disciplinaId, pesoPercentual: p.pesoPercentual };
      });

      await tx.plano.create({
        data: {
          id: planoId,
          titulo: dto.titulo ?? `${origem.titulo} (pessoal)`.slice(0, TITULO_MAX),
          descricao: normalizeDescricao(origem.descricao),
          tipo: PlanoTipo.PESSOAL,
          autorId: user.sub,
          planoOrigemId: origem.id,
        },
      });
      if (disciplinasData.length > 0) await tx.disciplina.createMany({ data: disciplinasData });
      if (temasData.length > 0) await tx.tema.createMany({ data: temasData });
      if (subtemasData.length > 0) await tx.subtema.createMany({ data: subtemasData });
      if (pesosData.length > 0) await tx.pesoDisciplina.createMany({ data: pesosData });

      return planoId;
    });

    return this.getTree(novoId);
  }

  private async getTree(id: string): Promise<PlanoResponse> {
    const plano = await this.prisma.plano.findUnique({
      where: { id },
      include: planoTreeInclude,
    });
    if (!plano || plano.deletedAt !== null) {
      throw new NotFoundException('Plano não encontrado.');
    }
    return toPlanoResponse(plano);
  }

  /** Consistência (CA-05/CB-01/CB-04): ≥1 disciplina ativa e Σ pesos ativos = 100.00. */
  private async assertPlanoConsistente(
    planoId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const disciplinasAtivas = await client.disciplina.count({
      where: { planoId, deletedAt: null },
    });
    const pesos = await client.pesoDisciplina.findMany({
      where: { planoId, deletedAt: null },
      select: { pesoPercentual: true },
    });

    const details: { field: string; issue: string }[] = [];
    if (disciplinasAtivas === 0) {
      details.push({ field: 'disciplinas', issue: 'plano deve ter ao menos uma disciplina' });
    }
    const soma = pesos.reduce((acc, p) => acc.plus(p.pesoPercentual), new Prisma.Decimal(0));
    if (!soma.equals(CEM)) {
      details.push({ field: 'pesoPercentual', issue: 'soma deve ser 100' });
    }

    if (details.length > 0) {
      throw new UnprocessableEntityException({
        message:
          details.length === 1 && details[0].field === 'pesoPercentual'
            ? 'A soma dos pesos deve ser 100.'
            : 'Plano inconsistente: verifique disciplinas e pesos.',
        details,
      });
    }
  }
}

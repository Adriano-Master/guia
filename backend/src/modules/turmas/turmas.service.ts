import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, Turma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PaginatedResponse,
  paginated,
  parseSort,
  toSkipTake,
  toStableOrderBy,
} from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { ListTurmasQueryDto } from './dto/list-turmas-query.dto';
import { UpdateTurmaDto } from './dto/update-turma.dto';
import { toTurmaResponse, TurmaResponse } from './turma-response';
import { isModeracao, TurmasAccessService } from './turmas-access.service';

const SORTABLE_FIELDS = ['nome', 'createdAt'];

// 8 chars alfanuméricos sem ambíguos (0/O, 1/I/L) — decisão do design.
// 31^8 ≈ 8,5e11 combinações: colisão é raríssima, mas o unique do banco +
// retry cobrem o caso (CA "colisão é reprocessada").
const CODIGO_ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODIGO_TAMANHO = 8;
const CODIGO_MAX_TENTATIVAS = 5;

/** Normaliza descrição: trim; vazia/ausente vira null. */
function normalizeDescricao(descricao: string | null | undefined): string | null {
  const trimmed = descricao?.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class TurmasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TurmasAccessService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateTurmaDto): Promise<TurmaResponse> {
    // RN-01: o dono é quem criou (guard já garante role interna).
    const turma = await this.comCodigoUnico((codigoConvite) =>
      this.prisma.turma.create({
        data: {
          nome: dto.nome,
          descricao: normalizeDescricao(dto.descricao),
          professorId: user.sub,
          codigoConvite,
        },
      }),
    );
    return toTurmaResponse(turma, true);
  }

  async list(
    user: AuthenticatedUser,
    query: ListTurmasQueryDto,
  ): Promise<PaginatedResponse<TurmaResponse>> {
    const sort = parseSort(query.sort, SORTABLE_FIELDS);

    // Escopo: PROFESSOR vê as suas; ADMIN/MODERADOR veem todas (RN-01).
    const where: Prisma.TurmaWhereInput = {
      deletedAt: null,
      ...(isModeracao(user.role) ? {} : { professorId: user.sub }),
      ...(query.ativa !== undefined ? { ativa: query.ativa } : {}),
    };

    const [turmas, total] = await this.prisma.$transaction([
      this.prisma.turma.findMany({
        where,
        orderBy: toStableOrderBy(sort, { createdAt: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.turma.count({ where }),
    ]);

    return paginated(
      turmas.map((turma) => toTurmaResponse(turma, true)),
      query,
      total,
    );
  }

  async getById(user: AuthenticatedUser, id: string): Promise<TurmaResponse> {
    const turma = await this.access.loadTurmaOrThrow(id);
    await this.access.assertCanRead(turma, user);
    // Aluno matriculado lê a turma SEM codigoConvite (RN-02: o código é o
    // mecanismo de convite do professor, não um dado do aluno).
    return toTurmaResponse(turma, this.access.isDonoOuModeracao(turma, user));
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTurmaDto): Promise<TurmaResponse> {
    const turma = await this.access.loadTurmaOrThrow(id);
    this.access.assertDono(turma, user);

    const updated = await this.prisma.turma.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.descricao !== undefined ? { descricao: normalizeDescricao(dto.descricao) } : {}),
        ...(dto.ativa !== undefined ? { ativa: dto.ativa } : {}),
      },
    });
    return toTurmaResponse(updated, true);
  }

  /** RN-02: novo código invalida o anterior; matrículas existentes intactas. */
  async regenerarCodigo(user: AuthenticatedUser, id: string): Promise<string> {
    const turma = await this.access.loadTurmaOrThrow(id);
    this.access.assertDono(turma, user);

    const updated = await this.comCodigoUnico((codigoConvite) =>
      this.prisma.turma.update({ where: { id }, data: { codigoConvite } }),
    );
    return updated.codigoConvite;
  }

  /** RN-08: soft delete; matrículas e vínculos ficam inalcançáveis via 404 da turma. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const turma = await this.access.loadTurmaOrThrow(id);
    this.access.assertDono(turma, user);
    await this.prisma.turma.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Executa a operação com um código gerado; em colisão (P2002) tenta outro. */
  private async comCodigoUnico(operacao: (codigo: string) => Promise<Turma>): Promise<Turma> {
    for (let tentativa = 1; ; tentativa += 1) {
      try {
        return await operacao(this.gerarCodigoConvite());
      } catch (error) {
        const colisao =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!colisao || tentativa >= CODIGO_MAX_TENTATIVAS) {
          throw error;
        }
      }
    }
  }

  private gerarCodigoConvite(): string {
    let codigo = '';
    for (let i = 0; i < CODIGO_TAMANHO; i += 1) {
      codigo += CODIGO_ALFABETO[randomInt(CODIGO_ALFABETO.length)];
    }
    return codigo;
  }
}

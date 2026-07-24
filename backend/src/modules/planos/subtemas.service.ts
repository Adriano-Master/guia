import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubtemaDto } from './dto/create-subtema.dto';
import { UpdateSubtemaDto } from './dto/update-subtema.dto';
import { SubtemaResponse, toSubtemaResponse } from './plano-response';
import { PlanosAccessService } from './planos-access.service';

@Injectable()
export class SubtemasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlanosAccessService,
  ) {}

  async listByTema(user: AuthenticatedUser, temaId: string): Promise<SubtemaResponse[]> {
    const tema = await this.access.loadTemaOrThrow(temaId);
    await this.access.assertCanRead(tema.disciplina.plano, user);

    const subtemas = await this.prisma.subtema.findMany({
      where: { temaId, deletedAt: null },
      orderBy: { ordem: 'asc' },
    });
    return subtemas.map(toSubtemaResponse);
  }

  async create(
    user: AuthenticatedUser,
    temaId: string,
    dto: CreateSubtemaDto,
  ): Promise<SubtemaResponse> {
    // CA-10: tema inexistente/deletado → 404.
    const tema = await this.access.loadTemaOrThrow(temaId);
    this.access.assertCanEdit(tema.disciplina.plano, user);

    const subtema = await this.prisma.subtema.create({
      data: {
        temaId,
        nome: dto.nome,
        ordem: dto.ordem,
        duracaoEstimadaMin: dto.duracaoEstimadaMin ?? null,
      },
    });
    return toSubtemaResponse(subtema);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateSubtemaDto,
  ): Promise<SubtemaResponse> {
    const subtema = await this.access.loadSubtemaOrThrow(id);
    this.access.assertCanEdit(subtema.tema.disciplina.plano, user);

    const updated = await this.prisma.subtema.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
        ...(dto.duracaoEstimadaMin !== undefined
          ? { duracaoEstimadaMin: dto.duracaoEstimadaMin }
          : {}),
      },
    });
    return toSubtemaResponse(updated);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const subtema = await this.access.loadSubtemaOrThrow(id);
    this.access.assertCanEdit(subtema.tema.disciplina.plano, user);

    await this.prisma.subtema.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

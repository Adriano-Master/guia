import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDisciplinaDto } from './dto/create-disciplina.dto';
import { UpdateDisciplinaDto } from './dto/update-disciplina.dto';
import { DisciplinaResponse, toDisciplinaResponse } from './plano-response';
import { PlanosAccessService } from './planos-access.service';

@Injectable()
export class DisciplinasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlanosAccessService,
  ) {}

  async listByPlano(user: AuthenticatedUser, planoId: string): Promise<DisciplinaResponse[]> {
    const plano = await this.access.loadPlanoOrThrow(planoId);
    await this.access.assertCanRead(plano, user);

    const disciplinas = await this.prisma.disciplina.findMany({
      where: { planoId, deletedAt: null },
      orderBy: { ordem: 'asc' },
      include: {
        temas: {
          where: { deletedAt: null },
          orderBy: { ordem: 'asc' },
          include: { subtemas: { where: { deletedAt: null }, orderBy: { ordem: 'asc' } } },
        },
      },
    });
    return disciplinas.map(toDisciplinaResponse);
  }

  async create(
    user: AuthenticatedUser,
    planoId: string,
    dto: CreateDisciplinaDto,
  ): Promise<DisciplinaResponse> {
    const plano = await this.access.loadPlanoOrThrow(planoId);
    this.access.assertCanEdit(plano, user);

    const disciplina = await this.prisma.disciplina.create({
      data: { planoId, nome: dto.nome, ordem: dto.ordem },
    });
    return toDisciplinaResponse(disciplina);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateDisciplinaDto,
  ): Promise<DisciplinaResponse> {
    const disciplina = await this.access.loadDisciplinaOrThrow(id);
    this.access.assertCanEdit(disciplina.plano, user);

    const updated = await this.prisma.disciplina.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
      },
    });
    return toDisciplinaResponse(updated);
  }

  /** CB-04: cascata soft em temas/subtemas e no peso associado, em transação. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const disciplina = await this.access.loadDisciplinaOrThrow(id);
    this.access.assertCanEdit(disciplina.plano, user);

    const deletedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.subtema.updateMany({
        where: { deletedAt: null, tema: { disciplinaId: id } },
        data: { deletedAt },
      }),
      this.prisma.tema.updateMany({
        where: { deletedAt: null, disciplinaId: id },
        data: { deletedAt },
      }),
      this.prisma.pesoDisciplina.updateMany({
        where: { deletedAt: null, disciplinaId: id },
        data: { deletedAt },
      }),
      this.prisma.disciplina.update({ where: { id }, data: { deletedAt } }),
    ]);
  }
}

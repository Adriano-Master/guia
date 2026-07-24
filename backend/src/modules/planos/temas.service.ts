import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemaDto } from './dto/create-tema.dto';
import { UpdateTemaDto } from './dto/update-tema.dto';
import { TemaResponse, toTemaResponse } from './plano-response';
import { PlanosAccessService } from './planos-access.service';

@Injectable()
export class TemasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlanosAccessService,
  ) {}

  async listByDisciplina(user: AuthenticatedUser, disciplinaId: string): Promise<TemaResponse[]> {
    const disciplina = await this.access.loadDisciplinaOrThrow(disciplinaId);
    await this.access.assertCanRead(disciplina.plano, user);

    const temas = await this.prisma.tema.findMany({
      where: { disciplinaId, deletedAt: null },
      orderBy: { ordem: 'asc' },
      include: { subtemas: { where: { deletedAt: null }, orderBy: { ordem: 'asc' } } },
    });
    return temas.map(toTemaResponse);
  }

  async create(
    user: AuthenticatedUser,
    disciplinaId: string,
    dto: CreateTemaDto,
  ): Promise<TemaResponse> {
    // CA-10: disciplina inexistente/deletada → 404.
    const disciplina = await this.access.loadDisciplinaOrThrow(disciplinaId);
    this.access.assertCanEdit(disciplina.plano, user);

    const tema = await this.prisma.tema.create({
      data: { disciplinaId, nome: dto.nome, ordem: dto.ordem },
    });
    return toTemaResponse(tema);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTemaDto): Promise<TemaResponse> {
    const tema = await this.access.loadTemaOrThrow(id);
    this.access.assertCanEdit(tema.disciplina.plano, user);

    const updated = await this.prisma.tema.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
      },
    });
    return toTemaResponse(updated);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const tema = await this.access.loadTemaOrThrow(id);
    this.access.assertCanEdit(tema.disciplina.plano, user);

    const deletedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.subtema.updateMany({
        where: { deletedAt: null, temaId: id },
        data: { deletedAt },
      }),
      this.prisma.tema.update({ where: { id }, data: { deletedAt } }),
    ]);
  }
}

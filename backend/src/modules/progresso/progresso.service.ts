import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanosAccessService } from '../planos/planos-access.service';
import { ListProgressoSubtemasQueryDto } from './dto/list-progresso-subtemas-query.dto';
import { SetProgressoDto } from './dto/set-progresso.dto';
import {
  percentual,
  ProgressoMarcacaoResponse,
  ProgressoPlanoResponse,
  ProgressoSubtemaFlatItem,
  toProgressoMarcacaoResponse,
} from './progresso-response';

type ProgressoAluno = { subtemaId: string; concluido: boolean; concluidoEm: Date | null };

@Injectable()
export class ProgressoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planosAccess: PlanosAccessService,
  ) {}

  /**
   * Upsert idempotente por (aluno_id, subtema_id) — CA-03, RN-05, DT-04.
   * `concluidoEm` só é setado na transição para true e preservado em
   * remarcações (CB-05); desmarcar zera (CA-02) e desmarcar nunca marcado
   * cria o registro com concluido=false sem erro (CB-06).
   *
   * Escopo (RN-03, "plano do aluno"): regra definitiva de leitura do
   * PlanosAccessService — PESSOAL próprio ou OFICIAL publicado vinculado a
   * turma em que o aluno tem matrícula ATIVA, como sessões e cronograma.
   * AlunoPlanoAtivo segue não existindo — o "plano ativo" é resolvido no
   * frontend pelo cronograma ativo.
   */
  async setConcluido(
    user: AuthenticatedUser,
    subtemaId: string,
    dto: SetProgressoDto,
  ): Promise<ProgressoMarcacaoResponse> {
    const subtema = await this.planosAccess.loadSubtemaOrThrow(subtemaId);
    await this.planosAccess.assertCanRead(subtema.tema.disciplina.plano, user);

    // Janela read-then-upsert (aceita no MVP): PUTs concorrentes {false} e
    // {true} podem intercalar entre esta leitura e o upsert e preservar um
    // concluidoEm que deveria ser renovado. O efeito é só no timestamp — o
    // estado final `concluido` fica correto e o unique impede linha duplicada;
    // serializar com transação/lock não compensa aqui (precedente: pausas em
    // memória no SessoesService).
    const existente = await this.prisma.progressoSubtema.findUnique({
      where: { alunoId_subtemaId: { alunoId: user.sub, subtemaId } },
    });

    const jaConcluido =
      existente !== null && existente.deletedAt === null && existente.concluido;
    const concluidoEm = dto.concluido
      ? jaConcluido
        ? existente!.concluidoEm
        : new Date()
      : null;

    // `deletedAt: null` no update revive um registro soft-deleted: o unique
    // (aluno, subtema) impede uma linha nova, e o CronogramaService só enxerga
    // progresso com deletedAt null.
    const progresso = await this.prisma.progressoSubtema.upsert({
      where: { alunoId_subtemaId: { alunoId: user.sub, subtemaId } },
      create: { alunoId: user.sub, subtemaId, concluido: dto.concluido, concluidoEm },
      update: { concluido: dto.concluido, concluidoEm, deletedAt: null },
    });
    return toProgressoMarcacaoResponse(progresso);
  }

  /**
   * Progresso agregado do plano (CA-04..07, DT-02): duas queries — a árvore
   * ativa do plano (include aninhado filtrando deletedAt) e os
   * ProgressoSubtema do aluno — e agregação por folhas em memória. O DT-03
   * sugere `count(*) filter (where concluido)` em SQL; a agregação em memória
   * é equivalente (sem N+1, duas idas ao banco) e a árvore completa já é
   * necessária na resposta de qualquer forma — volumes de um plano são
   * pequenos (centenas de subtemas).
   */
  async calcularPlano(user: AuthenticatedUser, planoId: string): Promise<ProgressoPlanoResponse> {
    const plano = await this.planosAccess.loadPlanoOrThrow(planoId);
    await this.planosAccess.assertCanRead(plano, user);

    const [disciplinas, progressos] = await Promise.all([
      this.prisma.disciplina.findMany({
        where: { planoId, deletedAt: null },
        orderBy: { ordem: 'asc' },
        select: {
          id: true,
          nome: true,
          ordem: true,
          temas: {
            where: { deletedAt: null },
            orderBy: { ordem: 'asc' },
            select: {
              id: true,
              nome: true,
              ordem: true,
              subtemas: {
                where: { deletedAt: null },
                orderBy: { ordem: 'asc' },
                select: { id: true, nome: true, ordem: true },
              },
            },
          },
        },
      }),
      this.carregarProgressos(user.sub, planoId),
    ]);

    const porSubtema = new Map(progressos.map((p) => [p.subtemaId, p]));
    let planoConcluidos = 0;
    let planoTotais = 0;

    const disciplinasNodes = disciplinas.map((disciplina) => {
      let discConcluidos = 0;
      let discTotais = 0;

      const temasNodes = disciplina.temas.map((tema) => {
        const subtemasNodes = tema.subtemas.map((subtema) => {
          const progresso = porSubtema.get(subtema.id);
          const concluido = progresso?.concluido ?? false;
          return {
            subtemaId: subtema.id,
            nome: subtema.nome,
            ordem: subtema.ordem,
            concluido,
            concluidoEm:
              concluido && progresso?.concluidoEm ? progresso.concluidoEm.toISOString() : null,
          };
        });
        const concluidos = subtemasNodes.filter((s) => s.concluido).length;
        const totais = subtemasNodes.length;
        discConcluidos += concluidos;
        discTotais += totais;
        return {
          temaId: tema.id,
          nome: tema.nome,
          ordem: tema.ordem,
          progressoPercentual: percentual(concluidos, totais),
          concluidos,
          totais,
          subtemas: subtemasNodes,
        };
      });

      planoConcluidos += discConcluidos;
      planoTotais += discTotais;
      return {
        disciplinaId: disciplina.id,
        nome: disciplina.nome,
        ordem: disciplina.ordem,
        progressoPercentual: percentual(discConcluidos, discTotais),
        concluidos: discConcluidos,
        totais: discTotais,
        temas: temasNodes,
      };
    });

    return {
      planoId: plano.id,
      progressoPercentual: percentual(planoConcluidos, planoTotais),
      subtemasConcluidos: planoConcluidos,
      subtemasTotais: planoTotais,
      disciplinas: disciplinasNodes,
    };
  }

  /** Lista plana de subtemas do plano com flag de conclusão do aluno (US-04). */
  async listarSubtemas(
    user: AuthenticatedUser,
    query: ListProgressoSubtemasQueryDto,
  ): Promise<ProgressoSubtemaFlatItem[]> {
    const plano = await this.planosAccess.loadPlanoOrThrow(query.planoId);
    await this.planosAccess.assertCanRead(plano, user);

    // temaId inexistente/soft-deleted ou de outro plano → 404 (padrão CA-09),
    // não 200 [] silencioso.
    if (query.temaId) {
      const tema = await this.planosAccess.loadTemaOrThrow(query.temaId);
      if (tema.disciplina.planoId !== query.planoId) {
        throw new NotFoundException('Tema não encontrado.');
      }
    }

    const [subtemas, progressos] = await Promise.all([
      this.prisma.subtema.findMany({
        where: {
          deletedAt: null,
          tema: {
            deletedAt: null,
            ...(query.temaId ? { id: query.temaId } : {}),
            disciplina: { planoId: query.planoId, deletedAt: null },
          },
        },
        select: {
          id: true,
          nome: true,
          ordem: true,
          temaId: true,
          tema: { select: { ordem: true, disciplinaId: true, disciplina: { select: { ordem: true } } } },
        },
      }),
      this.carregarProgressos(user.sub, query.planoId),
    ]);

    const porSubtema = new Map(progressos.map((p) => [p.subtemaId, p]));
    return subtemas
      .sort(
        (a, b) =>
          a.tema.disciplina.ordem - b.tema.disciplina.ordem ||
          a.tema.ordem - b.tema.ordem ||
          a.ordem - b.ordem ||
          a.id.localeCompare(b.id),
      )
      .map((subtema) => {
        const progresso = porSubtema.get(subtema.id);
        const concluido = progresso?.concluido ?? false;
        return {
          subtemaId: subtema.id,
          nome: subtema.nome,
          ordem: subtema.ordem,
          temaId: subtema.temaId,
          disciplinaId: subtema.tema.disciplinaId,
          concluido,
          concluidoEm:
            concluido && progresso?.concluidoEm ? progresso.concluidoEm.toISOString() : null,
        };
      })
      .filter((item) => query.concluido === undefined || item.concluido === query.concluido);
  }

  private carregarProgressos(alunoId: string, planoId: string): Promise<ProgressoAluno[]> {
    return this.prisma.progressoSubtema.findMany({
      where: {
        alunoId,
        deletedAt: null,
        subtema: { tema: { disciplina: { planoId } } },
      },
      select: { subtemaId: true, concluido: true, concluidoEm: true },
    });
  }
}

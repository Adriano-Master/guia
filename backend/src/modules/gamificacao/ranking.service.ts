import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PaginatedResponse, paginated, toSkipTake } from '../../common/pagination/pagination';
import { TurmasAccessService } from '../turmas/turmas-access.service';
import { RankingQueryDto } from './dto/ranking-query.dto';
import {
  RankingItemResponse,
  RankingMeResponse,
  horasParaNumber,
} from './ranking-response';
import { PontuacaoCalculada, RankingRepository, RankingRow } from './ranking.repository';

const MINUTOS_POR_HORA = 60;

function toRankingItem(row: RankingRow): RankingItemResponse {
  return {
    posicao: row.posicao,
    alunoId: row.aluno_id,
    nome: row.nome,
    pontos: row.pontos,
    subtemasConcluidos: row.subtemas_concluidos,
    horasEstudadas: horasParaNumber(row.horas_estudadas),
  };
}

@Injectable()
export class RankingService {
  private readonly ptsSubtema: number;
  private readonly ptsHora: number;
  private readonly ptsBonusSem: number;

  constructor(
    config: ConfigService,
    private readonly repository: RankingRepository,
    private readonly turmasAccess: TurmasAccessService,
  ) {
    this.ptsSubtema = config.get<number>('PTS_SUBTEMA', 10);
    this.ptsHora = config.get<number>('PTS_HORA', 5);
    this.ptsBonusSem = config.get<number>('PTS_BONUS_SEM', 50);
  }

  // ------------------------------------------------------------- consultas

  async global(query: RankingQueryDto): Promise<PaginatedResponse<RankingItemResponse>> {
    const { skip, take } = toSkipTake(query);
    const [linhas, total] = await Promise.all([
      this.repository.paginaGlobal(skip, take),
      this.repository.totalGlobal(),
    ]);
    return paginated(linhas.map(toRankingItem), query, total);
  }

  /**
   * CA-05, mesmo precedente do módulo turmas: turma inexistente/soft-deleted
   * → 404; leitura permitida ao dono, ADMIN/MODERADOR ou aluno com matrícula
   * ATIVA — senão 403.
   */
  async porTurma(
    user: AuthenticatedUser,
    turmaId: string,
    query: RankingQueryDto,
  ): Promise<PaginatedResponse<RankingItemResponse>> {
    const turma = await this.turmasAccess.loadTurmaOrThrow(turmaId);
    await this.turmasAccess.assertCanRead(turma, user);

    const { skip, take } = toSkipTake(query);
    const [linhas, total] = await Promise.all([
      this.repository.paginaTurma(turma.id, skip, take),
      this.repository.totalTurma(turma.id),
    ]);
    return paginated(linhas.map(toRankingItem), query, total);
  }

  /** CA-06: posição global + por turma + composição da pontuação. */
  async me(user: AuthenticatedUser): Promise<RankingMeResponse> {
    const [linha, turmas] = await Promise.all([
      this.repository.posicaoGlobalDoAluno(user.sub),
      this.repository.posicoesPorTurmaDoAluno(user.sub),
    ]);

    // Aluno ATIVO sem registro entra no conjunto via LEFT JOIN (0/0/0 com
    // posição real); `linha` só é undefined no caso-limite de token válido de
    // aluno já fora do ranking (INATIVO/soft-deleted, RN-05) → tudo 0.
    const pontos = linha?.pontos ?? 0;
    const subtemasConcluidos = linha?.subtemas_concluidos ?? 0;
    const horasEstudadas = horasParaNumber(linha?.horas_estudadas);

    // Limitação deliberada: PontuacaoAluno não tem coluna de semanas/bônus
    // (data-model), então a composição é DERIVADA da fórmula com as constantes
    // atuais. Se as constantes mudarem por env, a derivação só volta a bater
    // após a próxima recomputação — daí o clamp em ≥ 0. floor(horas com 2
    // casas) é exato: minutos/60 arredondado a 2 casas nunca cruza um inteiro.
    const pontosSubtemas = this.ptsSubtema * subtemasConcluidos;
    const pontosHoras = this.ptsHora * Math.floor(horasEstudadas);
    const pontosBonus = Math.max(0, pontos - pontosSubtemas - pontosHoras);
    const semanasConsistentes =
      this.ptsBonusSem > 0 ? Math.floor(pontosBonus / this.ptsBonusSem) : 0;

    return {
      posicaoGlobal: linha ? linha.posicao : null,
      pontos,
      subtemasConcluidos,
      horasEstudadas,
      semanasConsistentes,
      composicao: { pontosSubtemas, pontosHoras, pontosBonus },
      turmas: turmas.map((t) => ({ turmaId: t.turma_id, nome: t.nome, posicao: t.posicao })),
    };
  }

  // --------------------------------------------------------- recomputação

  /**
   * Recomputa o agregado de TODOS os alunos ATIVOS (fluxo do design):
   * agregações set-based (uma query por insumo, não por aluno) + UPSERT em
   * lote. Idempotente: mesmos dados → mesmos pontos (CA-01). Retorna a
   * quantidade de alunos recomputados.
   */
  async recomputarTodos(): Promise<number> {
    const alunoIds = await this.repository.alunosAtivosIds();
    if (alunoIds.length === 0) {
      return 0;
    }

    const [subtemas, minutos, semanas] = await Promise.all([
      this.repository.subtemasConcluidosPorAluno(),
      this.repository.minutosPorAluno(),
      this.repository.semanasConsistentesPorAluno(),
    ]);

    const pontuacoes = alunoIds.map((alunoId) =>
      this.calcularPontuacao(
        alunoId,
        subtemas.get(alunoId) ?? 0,
        minutos.get(alunoId) ?? 0,
        semanas.get(alunoId) ?? 0,
      ),
    );
    await this.repository.upsertPontuacoes(pontuacoes);
    return alunoIds.length;
  }

  /**
   * Recomputação incremental (design: opcional, SEM endpoint público) — mesma
   * função de cálculo com escopo de 1 aluno. Aluno fora do conjunto do
   * ranking (INATIVO/soft-deleted/role interna) não é recomputado: preserva o
   * agregado existente (RN-05).
   */
  async recomputarAluno(alunoId: string): Promise<void> {
    if (!(await this.repository.isAlunoAtivo(alunoId))) {
      return;
    }
    const [subtemas, minutos, semanas] = await Promise.all([
      this.repository.subtemasConcluidosPorAluno(alunoId),
      this.repository.minutosPorAluno(alunoId),
      this.repository.semanasConsistentesPorAluno(alunoId),
    ]);
    await this.repository.upsertPontuacoes([
      this.calcularPontuacao(
        alunoId,
        subtemas.get(alunoId) ?? 0,
        minutos.get(alunoId) ?? 0,
        semanas.get(alunoId) ?? 0,
      ),
    ]);
  }

  /**
   * Fórmula do design (determinística, CA-01):
   * pontos = PTS_SUBTEMA*subtemas + PTS_HORA*floor(horas) + PTS_BONUS_SEM*semanas.
   * floor calculado sobre minutos inteiros (exato); horas materializadas com
   * 2 casas (half-up), mesmo arredondamento de estatísticas.
   */
  private calcularPontuacao(
    alunoId: string,
    subtemasConcluidos: number,
    minutos: number,
    semanasConsistentes: number,
  ): PontuacaoCalculada {
    const horasInteiras = Math.floor(minutos / MINUTOS_POR_HORA);
    const pontos =
      this.ptsSubtema * subtemasConcluidos +
      this.ptsHora * horasInteiras +
      this.ptsBonusSem * semanasConsistentes;
    return {
      alunoId,
      pontos,
      subtemasConcluidos,
      horasEstudadas: (Math.round((minutos / MINUTOS_POR_HORA) * 100) / 100).toFixed(2),
    };
  }
}

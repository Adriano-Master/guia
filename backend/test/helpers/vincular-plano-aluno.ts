import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Regra de matrícula (PlanosAccessService): aluno só lê plano OFICIAL
 * publicado se ele estiver vinculado (TurmaPlano) a uma turma não-deletada em
 * que o aluno tem Matricula ATIVA. Este helper monta essa ponte direto via
 * Prisma para as fixtures e2e: turma do professor + vínculo do plano +
 * matrículas ATIVAs dos alunos.
 */
export async function vincularPlanoAAlunos(
  prisma: PrismaService,
  args: { planoId: string; professorId: string; alunoIds: string[]; nome?: string },
): Promise<{ turmaId: string }> {
  const turma = await prisma.turma.create({
    data: {
      nome: args.nome ?? 'Turma E2E (regra de matrícula)',
      professorId: args.professorId,
      codigoConvite: `E2E${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    },
  });
  await prisma.turmaPlano.create({ data: { turmaId: turma.id, planoId: args.planoId } });
  if (args.alunoIds.length > 0) {
    await prisma.matricula.createMany({
      data: args.alunoIds.map((alunoId) => ({ turmaId: turma.id, alunoId })),
    });
  }
  return { turmaId: turma.id };
}

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Role, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { hashPassword, verifyPassword } from '../../common/security/password';
import {
  PaginatedResponse,
  paginated,
  parseSort,
  toSkipTake,
  toStableOrderBy,
} from '../../common/pagination/pagination';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { toUserResponse, UserResponse } from './user-response';

const SORTABLE_FIELDS = ['nome', 'email', 'createdAt', 'ultimoLoginAt'];

const SERIALIZABLE_RETRIES = 3;

export interface ImpersonationResult {
  accessToken: string;
  user: Pick<UserResponse, 'id' | 'nome' | 'email' | 'role'>;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async getMe(userId: string): Promise<UserResponse> {
    return toUserResponse(await this.findActiveOrThrow(userId));
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<UserResponse> {
    const user = await this.findActiveOrThrow(userId);

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== user.id) {
        throw new ConflictException('Email já em uso por outro usuário.');
      }
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
        },
      });
      return toUserResponse(updated);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email já em uso por outro usuário.');
      }
      throw error;
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findActiveOrThrow(userId);

    const senhaAtualOk =
      user.senhaHash !== null && (await verifyPassword(user.senhaHash, dto.senhaAtual));
    if (!senhaAtualOk) {
      throw new UnprocessableEntityException({
        message: 'Senha atual incorreta.',
        details: [{ field: 'senhaAtual', issue: 'senha atual incorreta' }],
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { senhaHash: await hashPassword(dto.senhaNova) },
    });
  }

  async list(query: ListUsersQueryDto): Promise<PaginatedResponse<UserResponse>> {
    const sort = parseSort(query.sort, SORTABLE_FIELDS);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { nome: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: toStableOrderBy(sort, { createdAt: 'desc' }),
        ...toSkipTake(query),
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginated(users.map(toUserResponse), query, total);
  }

  async getById(id: string): Promise<UserResponse> {
    return toUserResponse(await this.findActiveOrThrow(id));
  }

  async adminUpdate(id: string, dto: AdminUpdateUserDto): Promise<UserResponse> {
    // Isolamento SERIALIZABLE: garante que a checagem do último admin e o
    // update não intercalem com outra transação concorrente. Conflitos de
    // serialização (P2034) são re-tentados algumas vezes.
    const updated = await this.retryOnSerializationConflict(() =>
      this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({ where: { id } });
          if (!user || user.deletedAt !== null) {
            throw new NotFoundException('Usuário não encontrado.');
          }

          const nextRole = dto.role ?? user.role;
          const nextStatus = dto.status ?? user.status;

          const wasActiveAdmin = user.role === Role.ADMIN && user.status === UserStatus.ATIVO;
          const staysActiveAdmin = nextRole === Role.ADMIN && nextStatus === UserStatus.ATIVO;

          if (wasActiveAdmin && !staysActiveAdmin) {
            const otherActiveAdmins = await tx.user.count({
              where: {
                id: { not: user.id },
                role: Role.ADMIN,
                status: UserStatus.ATIVO,
                deletedAt: null,
              },
            });
            if (otherActiveAdmins === 0) {
              throw new ConflictException(
                'Não é possível rebaixar ou desativar o último ADMIN ativo.',
              );
            }
          }

          return tx.user.update({
            where: { id: user.id },
            data: { role: nextRole, status: nextStatus },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    return toUserResponse(updated);
  }

  /**
   * Visualização como aluno (impersonação somente-leitura pelo ADMIN): emite um
   * access token do aluno com a claim `impersonatedBy`, sem refresh token.
   * Status INATIVO é permitido de propósito — o admin pode inspecionar a conta.
   */
  async impersonate(adminId: string, alunoId: string): Promise<ImpersonationResult> {
    const user = await this.findActiveOrThrow(alunoId);

    if (user.role !== Role.ALUNO) {
      throw new UnprocessableEntityException({
        message: 'Apenas usuários com perfil ALUNO podem ser visualizados.',
        details: [{ field: 'id', issue: 'usuário não possui perfil ALUNO' }],
      });
    }

    // Auditoria por log estruturado, sem PII (minimização LGPD: os ids já
    // identificam o evento). Limitação conhecida: sem tabela de auditoria
    // persistente — o registro vive apenas nos logs da aplicação.
    this.logger.log(
      JSON.stringify({
        event: 'impersonation_started',
        adminId,
        alunoId: user.id,
      }),
    );

    const accessToken = await this.tokenService.signImpersonationToken(user, adminId);
    return {
      accessToken,
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
    };
  }

  private async retryOnSerializationConflict<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const isSerializationConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!isSerializationConflict || attempt >= SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }
  }

  private async findActiveOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt !== null) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}

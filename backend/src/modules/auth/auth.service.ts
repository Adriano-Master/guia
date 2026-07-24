import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword, verifyPassword } from '../../common/security/password';
import { toUserResponse, UserResponse } from '../users/user-response';
import { EMAIL_SERVICE, EmailService } from './email.service';
import { TOKEN_DENYLIST, TokenDenylist } from './token-denylist.service';
import { RefreshTokenPayload, ResetTokenPayload, TokenService } from './token.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends AuthTokens {
  user: UserResponse;
}

const INVALID_CREDENTIALS = 'Credenciais inválidas.';
const INVALID_REFRESH = 'Refresh token inválido ou expirado.';

// Hash argon2id gerado uma única vez no load do módulo. Usado para equalizar
// o tempo de resposta do login quando o email não existe ou a conta não tem
// senha, mitigando enumeração de contas por timing.
const DUMMY_PASSWORD_HASH: Promise<string> = hashPassword(randomUUID());

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
    @Inject(TOKEN_DENYLIST) private readonly denylist: TokenDenylist,
    @Inject(EMAIL_SERVICE) private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email já cadastrado.');
    }

    const senhaHash = await hashPassword(dto.senha);
    try {
      const user = await this.prisma.user.create({
        data: {
          nome: dto.nome,
          email: dto.email,
          senhaHash,
          role: 'ALUNO',
          origem: 'PROPRIO',
          status: 'ATIVO',
        },
      });
      return toUserResponse(user);
    } catch (error) {
      // Corrida entre a checagem e o insert: a constraint única decide.
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email já cadastrado.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Sempre verifica um hash — contra o real ou contra um dummy quando o
    // usuário não existe ou não tem senha — para não vazar por timing.
    let senhaOk = false;
    if (user?.senhaHash) {
      senhaOk = await verifyPassword(user.senhaHash, dto.senha);
    } else {
      await verifyPassword(await DUMMY_PASSWORD_HASH, dto.senha);
    }

    // Mensagem genérica: não revela se o email existe, se a senha está errada
    // ou se a conta está inativa/pendente (RN-03, requisito de login).
    if (!user || user.deletedAt !== null || user.status !== UserStatus.ATIVO || !senhaOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { ultimoLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(updated);
    return { ...tokens, user: toUserResponse(updated) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshOrThrow(refreshToken);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt !== null || user.status !== UserStatus.ATIVO) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    // Rotação: o jti antigo é negado pelo restante da sua validade.
    this.denylist.deny(payload.jti, payload.exp * 1000);
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    // Idempotente: token inválido/expirado já não dá acesso — responde 204.
    try {
      const payload = await this.tokenService.verifyRefreshToken(refreshToken);
      this.denylist.deny(payload.jti, payload.exp * 1000);
    } catch {
      return;
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Sempre "sucesso" (204) para não vazar existência de conta (RN-07).
    if (!user || user.deletedAt !== null || user.status === UserStatus.INATIVO) {
      return;
    }

    const { token } = await this.tokenService.signResetToken(user.id);
    const baseUrl = this.config.getOrThrow<string>('APP_BASE_URL');
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await this.emailService.sendPasswordReset(user.email, resetUrl);
    } catch (error) {
      // Falha de envio não pode virar 5xx nem vazar existência de conta:
      // loga (sem o token) e mantém o 204.
      this.logger.error(
        `Falha ao enviar email de reset de senha para ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const payload = await this.verifyResetOrThrow(dto.token);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt !== null || user.status === UserStatus.INATIVO) {
      throw this.invalidResetTokenError();
    }

    const senhaHash = await hashPassword(dto.senhaNova);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        senhaHash,
        // Usuário Hotmart sem senha (PENDENTE) passa a ATIVO ao definir senha (RN-04).
        ...(user.status === UserStatus.PENDENTE ? { status: UserStatus.ATIVO } : {}),
      },
    });

    // Uso único: nega o jti pelo restante da validade do token.
    this.denylist.deny(payload.jti, payload.exp * 1000);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const [accessToken, refresh] = await Promise.all([
      this.tokenService.signAccessToken(user),
      this.tokenService.signRefreshToken(user.id),
    ]);
    return { accessToken, refreshToken: refresh.token };
  }

  private async verifyRefreshOrThrow(refreshToken: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.tokenService.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    if (!payload.jti || this.denylist.isDenied(payload.jti)) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    return payload;
  }

  private async verifyResetOrThrow(token: string): Promise<ResetTokenPayload> {
    let payload: ResetTokenPayload;
    try {
      payload = await this.tokenService.verifyResetToken(token);
    } catch {
      throw this.invalidResetTokenError();
    }
    if (!payload.jti || this.denylist.isDenied(payload.jti)) {
      throw this.invalidResetTokenError();
    }
    return payload;
  }

  private invalidResetTokenError(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      message: 'Token de reset inválido, expirado ou já utilizado.',
      details: [{ field: 'token', issue: 'inválido, expirado ou já utilizado' }],
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}

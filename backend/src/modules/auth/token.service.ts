import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Origem, Role, User } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  origem: Origem;
  /** Presente apenas em tokens de impersonação (visualização como aluno): id do ADMIN. */
  impersonatedBy?: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface ResetTokenPayload {
  sub: string;
  jti: string;
  purpose: 'password_reset';
  iat: number;
  exp: number;
}

export const PASSWORD_RESET_TTL = '30m';

/** Emissão e verificação de todos os JWTs da plataforma (access, refresh, reset). */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccessToken(user: Pick<User, 'id' | 'role' | 'origem'>): Promise<string> {
    return this.jwt.signAsync(
      { role: user.role, origem: user.origem },
      {
        subject: user.id,
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '15m',
        ) as JwtSignOptions['expiresIn'],
      },
    );
  }

  /**
   * Token de impersonação (ADMIN visualizando como aluno): access token normal
   * do aluno (mesmo sub/role/origem e mesma expiração curta) acrescido da claim
   * assinada `impersonatedBy`. Nunca acompanha refresh token — expirou, o admin
   * precisa impersonar de novo.
   */
  signImpersonationToken(
    aluno: Pick<User, 'id' | 'role' | 'origem'>,
    adminId: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      { role: aluno.role, origem: aluno.origem, impersonatedBy: adminId },
      {
        subject: aluno.id,
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '15m',
        ) as JwtSignOptions['expiresIn'],
      },
    );
  }

  async signRefreshToken(userId: string): Promise<{ token: string; jti: string }> {
    const jti = randomUUID();
    const token = await this.jwt.signAsync(
      {},
      {
        subject: userId,
        jwtid: jti,
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as JwtSignOptions['expiresIn'],
      },
    );
    return { token, jti };
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
  }

  async signResetToken(userId: string): Promise<{ token: string; jti: string }> {
    const jti = randomUUID();
    const token = await this.jwt.signAsync(
      { purpose: 'password_reset' },
      {
        subject: userId,
        jwtid: jti,
        secret: this.resetSecret(),
        expiresIn: PASSWORD_RESET_TTL,
      },
    );
    return { token, jti };
  }

  async verifyResetToken(token: string): Promise<ResetTokenPayload> {
    const payload = await this.jwt.verifyAsync<ResetTokenPayload>(token, {
      secret: this.resetSecret(),
    });
    if (payload.purpose !== 'password_reset') {
      throw new Error('token não é de reset de senha');
    }
    return payload;
  }

  // Secret dedicado ao fluxo de reset, derivado do refresh secret — impede
  // que access/refresh tokens sejam aceitos como token de reset e vice-versa.
  private resetSecret(): string {
    return `${this.config.getOrThrow<string>('JWT_REFRESH_SECRET')}.password-reset`;
  }
}

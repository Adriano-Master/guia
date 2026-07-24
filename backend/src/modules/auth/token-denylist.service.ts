import { Injectable, OnModuleDestroy } from '@nestjs/common';

/**
 * Lista de negação de `jti` (refresh revogado por logout/rotação, token de
 * reset já usado). O design proíbe tabela nova para isto — é infraestrutura.
 */
export interface TokenDenylist {
  deny(jti: string, expiresAtMs: number): void;
  isDenied(jti: string): boolean;
}

export const TOKEN_DENYLIST = 'TOKEN_DENYLIST';

const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Implementação em memória (Map jti→expiração) com limpeza periódica.
 * ATENÇÃO: suficiente para instância única (MVP). Em produção com múltiplas
 * instâncias, substituir por implementação em Redis (mesma interface,
 * TTL = validade restante do token) trocando apenas o provider TOKEN_DENYLIST.
 */
@Injectable()
export class InMemoryTokenDenylistService implements TokenDenylist, OnModuleDestroy {
  private readonly entries = new Map<string, number>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  deny(jti: string, expiresAtMs: number): void {
    this.entries.set(jti, expiresAtMs);
  }

  isDenied(jti: string): boolean {
    const expiresAt = this.entries.get(jti);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= Date.now()) {
      this.entries.delete(jti);
      return false;
    }
    return true;
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(jti);
      }
    }
  }
}

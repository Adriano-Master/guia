import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /health — fora do prefixo /api/v1 (excluído em main.ts), usado pelo
 * healthcheck do Docker. Responde 200 se a API e o banco estão acessíveis.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; database: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }

    return {
      status: 'ok',
      database: 'up',
      timestamp: new Date().toISOString(),
    };
  }
}

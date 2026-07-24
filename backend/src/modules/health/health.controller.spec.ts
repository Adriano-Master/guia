import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('retorna status ok quando o banco responde', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('lança 503 quando o banco está indisponível', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

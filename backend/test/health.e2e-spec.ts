import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  const prismaMock = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(createGlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responde 200 fora do prefixo /api/v1', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(response.headers['x-trace-id']).toBeDefined();
  });

  it('rota inexistente retorna 404 com envelope de erro padrão', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nao-existe').expect(404);

    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: expect.any(String),
      traceId: expect.any(String),
    });
  });
});

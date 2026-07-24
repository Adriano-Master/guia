import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createGlobalValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Atrás do nginx (1 hop): confia no X-Forwarded-For para que req.ip seja o
  // IP real do cliente — essencial para o rate limiting por IP funcionar.
  app.set('trust proxy', 1);

  app.use(helmet());

  // /health fica fora do prefixo para o healthcheck do Docker.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.enableCors({
    origin: config.get<string>('APP_BASE_URL'),
    credentials: true,
  });

  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();

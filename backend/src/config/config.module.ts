import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // .env local do backend ou .env da raiz do repositório (dev fora do Docker).
      envFilePath: ['.env', '../.env'],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}

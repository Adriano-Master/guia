import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CronogramaModule } from './modules/cronograma/cronograma.module';
import { EstatisticasModule } from './modules/estatisticas/estatisticas.module';
import { GamificacaoModule } from './modules/gamificacao/gamificacao.module';
import { HealthModule } from './modules/health/health.module';
import { PlanosModule } from './modules/planos/planos.module';
import { ProgressoModule } from './modules/progresso/progresso.module';
import { QuestoesModule } from './modules/questoes/questoes.module';
import { SessoesModule } from './modules/sessoes/sessoes.module';
import { TurmasModule } from './modules/turmas/turmas.module';
import { UsersModule } from './modules/users/users.module';
import { traceIdMiddleware } from './common/middleware/trace-id.middleware';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    PlanosModule,
    CronogramaModule,
    SessoesModule,
    ProgressoModule,
    QuestoesModule,
    EstatisticasModule,
    TurmasModule,
    GamificacaoModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(traceIdMiddleware).forRoutes('*');
  }
}

import { Module } from '@nestjs/common';
import { TurmasModule } from '../turmas/turmas.module';
import { RankingController } from './ranking.controller';
import { RankingRepository } from './ranking.repository';
import { RankingScheduler } from './ranking.scheduler';
import { RankingService } from './ranking.service';

@Module({
  imports: [TurmasModule],
  controllers: [RankingController],
  providers: [RankingRepository, RankingService, RankingScheduler],
  exports: [RankingService],
})
export class GamificacaoModule {}

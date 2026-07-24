import { Module } from '@nestjs/common';
import { EstatisticasController } from './estatisticas.controller';
import { EstatisticasService } from './estatisticas.service';

@Module({
  controllers: [EstatisticasController],
  providers: [EstatisticasService],
})
export class EstatisticasModule {}

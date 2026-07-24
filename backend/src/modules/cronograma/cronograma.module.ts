import { Module } from '@nestjs/common';
import { PlanosModule } from '../planos/planos.module';
import { CronogramaController } from './cronograma.controller';
import { CronogramaService } from './cronograma.service';

@Module({
  imports: [PlanosModule],
  controllers: [CronogramaController],
  providers: [CronogramaService],
  exports: [CronogramaService],
})
export class CronogramaModule {}

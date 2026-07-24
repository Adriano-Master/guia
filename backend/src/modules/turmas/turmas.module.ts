import { Module } from '@nestjs/common';
import { PlanosModule } from '../planos/planos.module';
import { MatriculasController } from './matriculas.controller';
import { MatriculasService } from './matriculas.service';
import { TurmaPlanosController } from './turma-planos.controller';
import { TurmaPlanosService } from './turma-planos.service';
import { TurmasAccessService } from './turmas-access.service';
import { TurmasController } from './turmas.controller';
import { TurmasService } from './turmas.service';

@Module({
  imports: [PlanosModule],
  controllers: [TurmasController, MatriculasController, TurmaPlanosController],
  providers: [TurmasAccessService, TurmasService, MatriculasService, TurmaPlanosService],
  exports: [TurmasAccessService],
})
export class TurmasModule {}

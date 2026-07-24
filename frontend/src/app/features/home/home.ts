import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <main class="home-page">
      <nav class="home-page__topbar" aria-label="Navegação da página inicial">
        <a class="home-page__brand" routerLink="/">
          <span class="home-page__brand-initial" aria-hidden="true">G</span>
          Guia de Estudos
        </a>
        @if (!user()) {
          <div class="home-page__topbar-actions">
            <a class="btn btn--outline btn--sm" routerLink="/login">Entrar</a>
            <a class="btn btn--primary btn--sm" routerLink="/register">Criar conta</a>
          </div>
        }
      </nav>

      <section class="home">
      <header class="home__hero">
        <span class="home__badge">Plataforma de estudos para concursos</span>
        <h1 class="home__title">
          Organize seus estudos.<br />
          <span class="home__title-accent">Conquiste sua aprovação.</span>
        </h1>
        <p class="home__subtitle">
          Planos de estudo, cronograma inteligente, registro de sessões e questões,
          estatísticas de desempenho e ranking — tudo em um só lugar.
        </p>
        <div class="home__actions">
          @if (user()) {
            <a class="btn btn--primary" routerLink="/cronograma">Ir para meu cronograma</a>
            <a class="btn btn--outline" routerLink="/progresso">Ver meu progresso</a>
          } @else {
            <a class="btn btn--primary" routerLink="/register">Criar conta grátis</a>
            <a class="btn btn--outline" routerLink="/login">Já tenho conta</a>
          }
        </div>
      </header>

      <ul class="home__features">
        @for (feature of features; track feature.title) {
          <li class="card card--flat home__feature">
            <span class="home__feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path [attr.d]="feature.icon" />
              </svg>
            </span>
            <h2 class="home__feature-title">{{ feature.title }}</h2>
            <p class="home__feature-text">{{ feature.text }}</p>
          </li>
        }
      </ul>

      <section class="card home__cta">
        <h2 class="home__cta-title">Pronto para começar?</h2>
        <p class="home__cta-text">
          Crie sua conta, monte seu plano de estudos e acompanhe sua evolução dia após dia.
        </p>
        @if (!user()) {
          <a class="btn btn--primary" routerLink="/register">Começar agora</a>
        } @else {
          <a class="btn btn--primary" routerLink="/planos">Ver meus planos</a>
        }
      </section>
      </section>
    </main>
  `,
  styles: `
    .home-page {
      min-height: 100dvh;
      padding: 1rem clamp(1rem, 4vw, 2rem) 3rem;
    }

    .home-page__topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      max-width: 64rem;
      margin: 0 auto;
    }

    .home-page__brand {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      font-weight: 700;
      color: var(--text-primary);
      text-decoration: none;
    }

    .home-page__brand-initial {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 0.6rem;
      background: var(--accent);
      color: var(--accent-contrast);
      font-size: 1rem;
    }

    .home-page__topbar-actions {
      display: flex;
      gap: 0.5rem;
    }

    .home {
      display: grid;
      gap: 3rem;
      max-width: 64rem;
      margin: 0 auto;
      padding-block: 2rem 3rem;
    }

    .home__hero {
      display: grid;
      gap: 1rem;
      justify-items: center;
      text-align: center;
      padding-top: 6dvh;
    }

    .home__badge {
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--accent);
      border: 1px solid var(--glass-border);
      border-radius: 999px;
      padding: 0.35rem 0.9rem;
      background: var(--surface-flat);
    }

    .home__title {
      margin: 0;
      font-size: clamp(2rem, 5vw, 3rem);
      line-height: 1.15;
    }

    .home__title-accent {
      color: var(--accent);
    }

    .home__subtitle {
      margin: 0;
      max-width: 38rem;
      color: var(--text-secondary);
      font-size: 1.05rem;
    }

    .home__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .home__features {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
      gap: 1rem;
    }

    .home__feature {
      display: grid;
      gap: 0.5rem;
      align-content: start;
    }

    .home__feature-icon {
      display: inline-flex;
      width: 2.5rem;
      height: 2.5rem;
      align-items: center;
      justify-content: center;
      border-radius: 0.75rem;
      background: var(--surface-inset);
      color: var(--accent);
    }

    .home__feature-icon svg {
      width: 1.35rem;
      height: 1.35rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .home__feature-title {
      margin: 0;
      font-size: 1.05rem;
    }

    .home__feature-text {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .home__cta {
      display: grid;
      gap: 0.75rem;
      justify-items: center;
      text-align: center;
    }

    .home__cta-title {
      margin: 0;
      font-size: 1.5rem;
    }

    .home__cta-text {
      margin: 0;
      max-width: 32rem;
      color: var(--text-secondary);
    }
  `,
})
export default class Home {
  private readonly auth = inject(AuthService);
  readonly user = this.auth.currentUser;

  readonly features = [
    {
      title: 'Planos de estudo',
      text: 'Estruture disciplinas e assuntos do seu edital em planos organizados por peso e prioridade.',
      icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
    },
    {
      title: 'Cronograma inteligente',
      text: 'Distribua seus estudos pela semana e saiba exatamente o que estudar em cada dia.',
      icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    },
    {
      title: 'Sessões de estudo',
      text: 'Registre o tempo dedicado a cada assunto e mantenha a constância nos estudos.',
      icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    },
    {
      title: 'Questões',
      text: 'Acompanhe acertos e erros por disciplina e descubra onde reforçar a revisão.',
      icon: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    },
    {
      title: 'Estatísticas e progresso',
      text: 'Visualize sua evolução com gráficos de horas, desempenho e cobertura do edital.',
      icon: 'M3 3v16a2 2 0 0 0 2 2h16M7 15l4-4 3 3 5-6',
    },
    {
      title: 'Ranking e gamificação',
      text: 'Ganhe pontos pelas suas atividades e dispute o ranking com outros alunos da turma.',
      icon: 'M8 21h8m-4-4v4m-6-17h12v4a6 6 0 0 1-12 0V4Zm-3 2h3m12 0h3m-18 0v1a3 3 0 0 0 3 3m15-4v1a3 3 0 0 1-3 3',
    },
  ];
}

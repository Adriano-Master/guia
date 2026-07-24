import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { InstallService } from '../../core/pwa/install.service';
import { SessaoAtivaService } from '../../core/sessao-ativa/sessao-ativa.service';

const SIDEBAR_KEY = 'guia.sidebar-collapsed';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly impersonation = inject(ImpersonationService);
  protected readonly install = inject(InstallService);
  // Injetado no shell (sempre montado): dispara a hidratação do cronômetro no
  // boot/login de ALUNO e alimenta o widget do aside.
  protected readonly sessaoAtiva = inject(SessaoAtivaService);

  /** Nome acessível do widget: estado + tempo, não só a cor/ícone. */
  protected readonly cronoLabel = computed(
    () =>
      `Cronômetro ${this.sessaoAtiva.pausado() ? 'pausado' : 'em andamento'}: ` +
      `${this.sessaoAtiva.decorridoLabel()}. Ir para a página Estudar`,
  );

  private readonly sidebar = viewChild<ElementRef<HTMLElement>>('sidebar');
  private readonly hamburger = viewChild<ElementRef<HTMLButtonElement>>('hamburger');

  protected readonly collapsed = signal(this.restoreCollapsed());
  protected readonly drawerOpen = signal(false);
  protected readonly iosHintOpen = signal(false);

  constructor() {
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeDrawer(false));

    // Drawer aberto (mobile): o fundo fica inacessível via role="dialog" +
    // aria-modal no aside e `inert` no <main> (o topbar fica de fora para o
    // hambúrguer continuar operável como toggle e receber o foco de volta).
    // Aqui, trava o scroll do body; onCleanup desfaz ao fechar/destruir.
    effect((onCleanup) => {
      if (!this.drawerOpen()) return;
      document.body.style.overflow = 'hidden';
      onCleanup(() => {
        document.body.style.overflow = '';
      });
    });
  }

  logout(): void {
    // Sair durante a impersonação: primeiro restaura a sessão real do admin
    // (senão o backup ressuscitaria a sessão no próximo boot) e desloga de fato.
    if (this.impersonation.ativo()) {
      this.impersonation.sair();
    }
    this.auth.logout();
  }

  /** Skip-link: com <base href="/">, href="#conteudo" navegaria para "/#conteudo". */
  skipToContent(event: Event): void {
    event.preventDefault();
    document.getElementById('conteudo')?.focus();
  }

  toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    try {
      localStorage.setItem(SIDEBAR_KEY, this.collapsed() ? '1' : '0');
    } catch {
      // só não persiste
    }
  }

  toggleDrawer(): void {
    if (this.drawerOpen()) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  openDrawer(): void {
    this.drawerOpen.set(true);
    // aguarda o drawer ficar visível antes de mover o foco (a11y)
    setTimeout(() => this.focusableInSidebar()[0]?.focus());
  }

  closeDrawer(restoreFocus = true): void {
    if (!this.drawerOpen()) return;
    this.drawerOpen.set(false);
    this.iosHintOpen.set(false);
    if (restoreFocus) this.hamburger()?.nativeElement.focus();
  }

  promptInstall(): void {
    void this.install.promptInstall();
  }

  /** Mantém Tab circulando dentro do drawer enquanto ele está aberto (mobile). */
  onSidebarKeydown(event: KeyboardEvent): void {
    if (!this.drawerOpen() || event.key !== 'Tab') return;
    const focusables = this.focusableInSidebar();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusableInSidebar(): HTMLElement[] {
    const host = this.sidebar()?.nativeElement;
    if (!host) return [];
    return Array.from(host.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
  }

  private restoreCollapsed(): boolean {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  }
}

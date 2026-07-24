import { Injectable, computed, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Instalação do PWA: captura `beforeinstallprompt` (Android/desktop) e expõe
 * `canInstall`/`promptInstall()`. No iOS/Safari não existe o evento, então
 * `showIosHint` indica quando exibir a dica de "Adicionar à Tela de Início".
 * Nada é exibido quando o app já roda instalado (display-mode: standalone).
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  private readonly canInstallSignal = signal(false);
  readonly canInstall = this.canInstallSignal.asReadonly();

  readonly isStandalone: boolean = false;
  readonly isIos: boolean = false;

  readonly showIosHint = computed(
    () => this.isIos && !this.isStandalone && !this.canInstallSignal(),
  );

  constructor() {
    // guarda única de ambiente sem browser (consistência/futuro SSR)
    if (typeof window === 'undefined') return;

    this.isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    this.isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      if (!this.isStandalone) this.canInstallSignal.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstallSignal.set(false);
    });
  }

  async promptInstall(): Promise<void> {
    const deferred = this.deferredPrompt;
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    this.deferredPrompt = null;
    this.canInstallSignal.set(false);
  }
}

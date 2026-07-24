import { TestBed } from '@angular/core/testing';

import { InstallService } from './install.service';

/**
 * Testes do InstallService (pwa-frontend.md §1 — prompt "Adicionar à tela
 * inicial"): captura de beforeinstallprompt (preventDefault + canInstall),
 * appinstalled zera o estado, promptInstall consome o evento adiado e
 * showIosHint aparece só em iOS fora do modo standalone.
 */

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

function mockUserAgent(value: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
}

function mockStandalone(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)' ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function createService(): InstallService {
  return TestBed.inject(InstallService);
}

interface PromptStub {
  event: Event;
  prompt: ReturnType<typeof vi.fn>;
  preventDefault: ReturnType<typeof vi.spyOn>;
}

/** Simula o beforeinstallprompt do Chrome (evento cancelável com prompt()). */
function dispatchBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted'): PromptStub {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  const preventDefault = vi.spyOn(event, 'preventDefault');
  window.dispatchEvent(event);
  return { event, prompt, preventDefault };
}

beforeEach(() => {
  mockUserAgent(ANDROID_UA);
  mockStandalone(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  // remove overrides próprios da instância (volta aos getters do jsdom)
  delete (window.navigator as unknown as Record<string, unknown>)['userAgent'];
  delete (window as unknown as Record<string, unknown>)['matchMedia'];
});

describe('InstallService — beforeinstallprompt / appinstalled', () => {
  it('canInstall é false por default', () => {
    const service = createService();
    expect(service.canInstall()).toBe(false);
  });

  it('beforeinstallprompt → preventDefault chamado e canInstall true', () => {
    const service = createService();

    const { preventDefault } = dispatchBeforeInstallPrompt();

    // "ao menos uma vez": instâncias de testes anteriores também escutam o
    // window compartilhado do jsdom (em produção o service é singleton).
    expect(preventDefault).toHaveBeenCalled();
    expect(service.canInstall()).toBe(true);
  });

  it('appinstalled → canInstall volta a false', () => {
    const service = createService();
    dispatchBeforeInstallPrompt();
    expect(service.canInstall()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    expect(service.canInstall()).toBe(false);
  });

  it('beforeinstallprompt em modo standalone não habilita canInstall', () => {
    mockStandalone(true);
    const service = createService();

    dispatchBeforeInstallPrompt();

    expect(service.canInstall()).toBe(false);
  });
});

describe('InstallService — promptInstall()', () => {
  it('sem evento adiado → no-op (não lança)', async () => {
    const service = createService();
    await expect(service.promptInstall()).resolves.toBeUndefined();
  });

  it('com evento adiado → chama prompt(), aguarda userChoice e zera canInstall', async () => {
    const service = createService();
    const { prompt } = dispatchBeforeInstallPrompt('accepted');

    await service.promptInstall();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(service.canInstall()).toBe(false);

    // evento já consumido: segunda chamada não repete o prompt
    await service.promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

describe('InstallService — showIosHint', () => {
  it('iOS Safari fora do standalone → true', () => {
    mockUserAgent(IOS_UA);
    const service = createService();

    expect(service.isIos).toBe(true);
    expect(service.showIosHint()).toBe(true);
  });

  it('iOS já instalado (standalone) → false', () => {
    mockUserAgent(IOS_UA);
    mockStandalone(true);
    const service = createService();

    expect(service.showIosHint()).toBe(false);
  });

  it('Android/desktop → false (usa o fluxo beforeinstallprompt)', () => {
    const service = createService();
    expect(service.isIos).toBe(false);
    expect(service.showIosHint()).toBe(false);
  });

  it('iPad com UA de desktop (MacIntel + touch) → true', () => {
    mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });

    const service = createService();

    expect(service.isIos).toBe(true);
    expect(service.showIosHint()).toBe(true);

    delete (window.navigator as unknown as Record<string, unknown>)['platform'];
    delete (window.navigator as unknown as Record<string, unknown>)['maxTouchPoints'];
  });
});

import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="card">
        <h1>Entrar</h1>
        <p class="auth-page__subtitle">Acesse sua conta para continuar os estudos.</p>

        @if (error()) {
          <p class="alert alert--error" role="alert">{{ error() }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field" [class.field--invalid]="errorFor('email')">
            <label for="email">Email</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" />
            @if (errorFor('email'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <div class="field" [class.field--invalid]="errorFor('senha')">
            <label for="senha">Senha</label>
            <input id="senha" type="password" formControlName="senha" autocomplete="current-password" />
            @if (errorFor('senha'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <button class="btn btn--primary btn--block" type="submit" [disabled]="loading()">
            {{ loading() ? 'Entrando…' : 'Entrar' }}
          </button>
        </form>

        <div class="auth-page__links">
          <a routerLink="/forgot-password">Esqueci minha senha</a>
          <span>Não tem conta? <a routerLink="/register">Cadastre-se</a></span>
        </div>
      </section>
    </main>
  `,
})
export default class Login {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(8)]],
  });

  errorFor(name: 'email' | 'senha'): string | null {
    return fieldErrorMessage(this.form.get(name));
  }

  submit(): void {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, senha } = this.form.getRawValue();
    this.loading.set(true);
    this.auth.login(email, senha).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(returnUrl && returnUrl.startsWith('/') ? returnUrl : '/');
      },
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        switch (apiError.code) {
          case 'UNAUTHENTICATED':
            this.error.set('Email ou senha inválidos.');
            break;
          case 'RATE_LIMITED':
            this.error.set('Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
            break;
          case 'VALIDATION_ERROR':
            applyFieldErrors(this.form, apiError);
            this.error.set(apiError.message);
            break;
          default:
            this.error.set(apiError.message);
        }
      },
    });
  }
}

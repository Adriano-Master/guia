import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="card">
        <h1>Recuperar senha</h1>
        <p class="auth-page__subtitle">
          Informe seu email e enviaremos um link para redefinir a senha.
        </p>

        @if (sent()) {
          <p class="alert alert--success" role="status">
            Se existir uma conta com este email, você receberá um link de redefinição em instantes.
            Verifique também a caixa de spam.
          </p>
          <div class="auth-page__links">
            <a routerLink="/login">Voltar para o login</a>
          </div>
        } @else {
          @if (error()) {
            <p class="alert alert--error" role="alert">{{ error() }}</p>
          }

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="field" [class.field--invalid]="emailError()">
              <label for="email">Email</label>
              <input id="email" type="email" formControlName="email" autocomplete="email" />
              @if (emailError(); as msg) {
                <span class="field__error">{{ msg }}</span>
              }
            </div>

            <button class="btn btn--primary btn--block" type="submit" [disabled]="loading()">
              {{ loading() ? 'Enviando…' : 'Enviar link de recuperação' }}
            </button>
          </form>

          <div class="auth-page__links">
            <a routerLink="/login">Voltar para o login</a>
          </div>
        }
      </section>
    </main>
  `,
})
export default class ForgotPassword {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  emailError(): string | null {
    return fieldErrorMessage(this.form.get('email'));
  }

  submit(): void {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.auth.forgotPassword(this.form.getRawValue().email).subscribe({
      next: () => this.sent.set(true),
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        this.error.set(
          apiError.code === 'RATE_LIMITED'
            ? 'Muitas solicitações. Aguarde alguns minutos e tente novamente.'
            : apiError.message,
        );
      },
    });
  }
}

import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';

function senhasIguais(group: AbstractControl): ValidationErrors | null {
  const senha = group.get('senhaNova')?.value as string;
  const confirmacao = group.get('confirmacao');
  if (!confirmacao) return null;

  const errors = { ...confirmacao.errors };
  if (senha && confirmacao.value && senha !== confirmacao.value) {
    confirmacao.setErrors({ ...errors, mismatch: true });
  } else if (errors['mismatch']) {
    delete errors['mismatch'];
    confirmacao.setErrors(Object.keys(errors).length > 0 ? errors : null);
  }
  return null;
}

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="card">
        <h1>Redefinir senha</h1>

        @if (!token) {
          <p class="alert alert--error" role="alert">
            Link de redefinição inválido ou incompleto. Solicite um novo link.
          </p>
          <div class="auth-page__links">
            <a routerLink="/forgot-password">Solicitar novo link</a>
          </div>
        } @else if (done()) {
          <p class="alert alert--success" role="status">
            Senha redefinida com sucesso. Você já pode entrar com a nova senha.
          </p>
          <div class="auth-page__links">
            <a routerLink="/login">Ir para o login</a>
          </div>
        } @else {
          <p class="auth-page__subtitle">Escolha uma nova senha para sua conta.</p>

          @if (error()) {
            <p class="alert alert--error" role="alert">{{ error() }}</p>
          }

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="field" [class.field--invalid]="errorFor('senhaNova')">
              <label for="senhaNova">Nova senha</label>
              <input
                id="senhaNova"
                type="password"
                formControlName="senhaNova"
                autocomplete="new-password"
              />
              @if (errorFor('senhaNova'); as msg) {
                <span class="field__error">{{ msg }}</span>
              } @else {
                <span class="field__hint">Mínimo de 8 caracteres.</span>
              }
            </div>

            <div class="field" [class.field--invalid]="errorFor('confirmacao')">
              <label for="confirmacao">Confirmar nova senha</label>
              <input
                id="confirmacao"
                type="password"
                formControlName="confirmacao"
                autocomplete="new-password"
              />
              @if (errorFor('confirmacao'); as msg) {
                <span class="field__error">{{ msg }}</span>
              }
            </div>

            <button class="btn btn--primary btn--block" type="submit" [disabled]="loading()">
              {{ loading() ? 'Salvando…' : 'Redefinir senha' }}
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
export default class ResetPassword {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);

  readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  readonly loading = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group(
    {
      senhaNova: ['', [Validators.required, Validators.minLength(8)]],
      confirmacao: ['', [Validators.required]],
    },
    { validators: [senhasIguais] },
  );

  errorFor(name: 'senhaNova' | 'confirmacao'): string | null {
    return fieldErrorMessage(this.form.get(name));
  }

  submit(): void {
    this.error.set(null);
    if (this.form.invalid || !this.token) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.auth.resetPassword(this.token, this.form.getRawValue().senhaNova).subscribe({
      next: () => this.done.set(true),
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        switch (apiError.code) {
          case 'VALIDATION_ERROR': {
            const unmatched = applyFieldErrors(this.form, apiError);
            const tokenIssue = unmatched.some((d) => d.field === 'token');
            this.error.set(
              tokenIssue || !apiError.details?.length
                ? 'Link expirado ou já utilizado. Solicite um novo link de recuperação.'
                : 'Corrija os campos destacados.',
            );
            break;
          }
          case 'RATE_LIMITED':
            this.error.set('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
            break;
          default:
            this.error.set(apiError.message);
        }
      },
    });
  }
}

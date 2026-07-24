import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="card">
        <h1>Criar conta</h1>
        <p class="auth-page__subtitle">Cadastre-se para montar seu plano de estudos.</p>

        @if (error()) {
          <p class="alert alert--error" role="alert">{{ error() }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field" [class.field--invalid]="errorFor('nome')">
            <label for="nome">Nome</label>
            <input id="nome" type="text" formControlName="nome" autocomplete="name" />
            @if (errorFor('nome'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <div class="field" [class.field--invalid]="errorFor('email')">
            <label for="email">Email</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" />
            @if (errorFor('email'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <div class="field" [class.field--invalid]="errorFor('senha')">
            <label for="senha">Senha</label>
            <input id="senha" type="password" formControlName="senha" autocomplete="new-password" />
            @if (errorFor('senha'); as msg) {
              <span class="field__error">{{ msg }}</span>
            } @else {
              <span class="field__hint">Mínimo de 8 caracteres.</span>
            }
          </div>

          <button class="btn btn--primary btn--block" type="submit" [disabled]="loading()">
            {{ loading() ? 'Criando conta…' : 'Criar conta' }}
          </button>
        </form>

        <div class="auth-page__links">
          <span>Já tem conta? <a routerLink="/login">Entrar</a></span>
        </div>
      </section>
    </main>
  `,
})
export default class Register {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    nome: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(8)]],
  });

  errorFor(name: 'nome' | 'email' | 'senha'): string | null {
    return fieldErrorMessage(this.form.get(name));
  }

  submit(): void {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.auth.register(this.form.getRawValue()).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        switch (apiError.code) {
          case 'CONFLICT': {
            const email = this.form.get('email');
            email?.setErrors({ server: 'Este email já está em uso.' });
            email?.markAsTouched();
            this.error.set('Já existe uma conta com este email.');
            break;
          }
          case 'VALIDATION_ERROR': {
            const unmatched = applyFieldErrors(this.form, apiError);
            this.error.set(unmatched.length > 0 ? apiError.message : 'Corrija os campos destacados.');
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

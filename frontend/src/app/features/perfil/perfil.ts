import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AuthService } from '../../core/auth/auth.service';
import { UsersService } from '../../core/auth/users.service';
import { applyFieldErrors, extractApiError } from '../../core/http/api-error';
import { fieldErrorMessage } from '../../shared/forms/form-errors';
import { ThemeSwitcher } from '../../shared/theme/theme-switcher';

@Component({
  selector: 'app-perfil',
  imports: [ReactiveFormsModule, DatePipe, ThemeSwitcher],
  template: `
    <section class="perfil">
      <h1>Meu perfil</h1>

      <div class="card">
        <h2>Aparência</h2>
        <p class="perfil__meta">
          Escolha um tema de cor; "Sistema" acompanha o modo claro/escuro do aparelho.
        </p>
        <app-theme-switcher variant="expanded" />
      </div>

      <div class="card">
        <h2>Dados pessoais</h2>
        @if (user(); as u) {
          <p class="perfil__meta">
            Conta criada em {{ u.createdAt | date: 'dd/MM/yyyy' }}
            @if (u.ultimoLoginAt) {
              · último acesso em {{ u.ultimoLoginAt | date: "dd/MM/yyyy 'às' HH:mm" }}
            }
          </p>
        }

        @if (profileError()) {
          <p class="alert alert--error" role="alert">{{ profileError() }}</p>
        }
        @if (profileSaved()) {
          <p class="alert alert--success" role="status">Dados atualizados com sucesso.</p>
        }

        <form [formGroup]="profileForm" (ngSubmit)="saveProfile()" novalidate>
          <div class="field" [class.field--invalid]="profileErrorFor('nome')">
            <label for="nome">Nome</label>
            <input id="nome" type="text" formControlName="nome" autocomplete="name" />
            @if (profileErrorFor('nome'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <div class="field" [class.field--invalid]="profileErrorFor('email')">
            <label for="email">Email</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" />
            @if (profileErrorFor('email'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <button class="btn btn--primary" type="submit" [disabled]="savingProfile()">
            {{ savingProfile() ? 'Salvando…' : 'Salvar alterações' }}
          </button>
        </form>
      </div>

      <div class="card">
        <h2>Alterar senha</h2>

        @if (passwordError()) {
          <p class="alert alert--error" role="alert">{{ passwordError() }}</p>
        }
        @if (passwordSaved()) {
          <p class="alert alert--success" role="status">Senha alterada com sucesso.</p>
        }

        <form [formGroup]="passwordForm" (ngSubmit)="changePassword()" novalidate>
          <div class="field" [class.field--invalid]="passwordErrorFor('senhaAtual')">
            <label for="senhaAtual">Senha atual</label>
            <input
              id="senhaAtual"
              type="password"
              formControlName="senhaAtual"
              autocomplete="current-password"
            />
            @if (passwordErrorFor('senhaAtual'); as msg) {
              <span class="field__error">{{ msg }}</span>
            }
          </div>

          <div class="field" [class.field--invalid]="passwordErrorFor('senhaNova')">
            <label for="senhaNova">Nova senha</label>
            <input
              id="senhaNova"
              type="password"
              formControlName="senhaNova"
              autocomplete="new-password"
            />
            @if (passwordErrorFor('senhaNova'); as msg) {
              <span class="field__error">{{ msg }}</span>
            } @else {
              <span class="field__hint">Mínimo de 8 caracteres.</span>
            }
          </div>

          <button class="btn btn--primary" type="submit" [disabled]="savingPassword()">
            {{ savingPassword() ? 'Alterando…' : 'Alterar senha' }}
          </button>
        </form>
      </div>
    </section>
  `,
  styles: `
    .perfil {
      display: grid;
      gap: 1rem;
      max-width: 34rem;
      margin: 0 auto;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 1.125rem;
    }
    .perfil__meta {
      margin: 0 0 1rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
  `,
})
export default class Perfil {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly usersService = inject(UsersService);

  readonly user = inject(AuthService).currentUser;

  readonly savingProfile = signal(false);
  readonly profileError = signal<string | null>(null);
  readonly profileSaved = signal(false);

  readonly savingPassword = signal(false);
  readonly passwordError = signal<string | null>(null);
  readonly passwordSaved = signal(false);

  readonly profileForm = this.fb.group({
    nome: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
  });

  readonly passwordForm = this.fb.group({
    senhaAtual: ['', [Validators.required]],
    senhaNova: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor() {
    const cached = this.user();
    if (cached) this.profileForm.patchValue({ nome: cached.nome, email: cached.email });
    this.usersService.getMe().subscribe({
      next: (user) => this.profileForm.patchValue({ nome: user.nome, email: user.email }),
      error: () => {
        // Sessão inválida é tratada pelo interceptor; mantém dados em cache.
      },
    });
  }

  profileErrorFor(name: 'nome' | 'email'): string | null {
    return fieldErrorMessage(this.profileForm.get(name));
  }

  passwordErrorFor(name: 'senhaAtual' | 'senhaNova'): string | null {
    return fieldErrorMessage(this.passwordForm.get(name));
  }

  saveProfile(): void {
    this.profileError.set(null);
    this.profileSaved.set(false);
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.savingProfile.set(true);
    this.usersService.updateMe(this.profileForm.getRawValue()).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.profileSaved.set(true);
      },
      error: (err: unknown) => {
        this.savingProfile.set(false);
        const apiError = extractApiError(err);
        if (apiError.code === 'CONFLICT') {
          const email = this.profileForm.get('email');
          email?.setErrors({ server: 'Este email já está em uso por outra conta.' });
          email?.markAsTouched();
          this.profileError.set('Este email já está em uso por outra conta.');
        } else if (apiError.code === 'VALIDATION_ERROR') {
          applyFieldErrors(this.profileForm, apiError);
          this.profileError.set('Corrija os campos destacados.');
        } else {
          this.profileError.set(apiError.message);
        }
      },
    });
  }

  changePassword(): void {
    this.passwordError.set(null);
    this.passwordSaved.set(false);
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { senhaAtual, senhaNova } = this.passwordForm.getRawValue();
    this.savingPassword.set(true);
    this.usersService.changePassword(senhaAtual, senhaNova).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.passwordSaved.set(true);
        this.passwordForm.reset();
      },
      error: (err: unknown) => {
        this.savingPassword.set(false);
        const apiError = extractApiError(err);
        if (apiError.code === 'VALIDATION_ERROR') {
          const unmatched = applyFieldErrors(this.passwordForm, apiError);
          if (!apiError.details?.length) {
            // 422 sem details: assume senha atual incorreta (contrato do backend).
            const senhaAtualControl = this.passwordForm.get('senhaAtual');
            senhaAtualControl?.setErrors({ server: 'Senha atual incorreta.' });
            senhaAtualControl?.markAsTouched();
          }
          this.passwordError.set(
            unmatched.length > 0 ? apiError.message : 'Corrija os campos destacados.',
          );
        } else {
          this.passwordError.set(apiError.message);
        }
      },
    });
  }
}

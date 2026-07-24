import type { AbstractControl } from '@angular/forms';

/** Mensagem pt-BR do primeiro erro de um control (inclui erro `server` do backend). */
export function fieldErrorMessage(control: AbstractControl | null): string | null {
  if (!control || !control.touched || !control.errors) return null;
  const errors = control.errors;
  if (errors['server']) return String(errors['server']);
  if (errors['required']) return 'Campo obrigatório.';
  if (errors['email']) return 'Informe um email válido.';
  if (errors['minlength']) {
    const { requiredLength } = errors['minlength'] as { requiredLength: number };
    return `Mínimo de ${requiredLength} caracteres.`;
  }
  if (errors['maxlength']) {
    const { requiredLength } = errors['maxlength'] as { requiredLength: number };
    return `Máximo de ${requiredLength} caracteres.`;
  }
  if (errors['mismatch']) return 'As senhas não coincidem.';
  return 'Valor inválido.';
}

import * as argon2 from 'argon2';

/** Hash de senha com argon2id (decisão do design de auth-e-usuarios). */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/** Verificação segura: retorna false para hash malformado em vez de lançar. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

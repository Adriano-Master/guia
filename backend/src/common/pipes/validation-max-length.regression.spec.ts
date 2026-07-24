import { ArgumentMetadata, UnprocessableEntityException } from '@nestjs/common';
import { createGlobalValidationPipe } from './validation.pipe';
import { RegisterDto } from '../../modules/auth/dto/register.dto';
import { ResetPasswordDto } from '../../modules/auth/dto/reset-password.dto';
import { ChangePasswordDto } from '../../modules/users/dto/change-password.dto';
import { UpdateMeDto } from '../../modules/users/dto/update-me.dto';

/**
 * Testes de REGRESSÃO das correções de code review em auth-e-usuarios:
 * limites de tamanho (@MaxLength) nos DTOs — senha ≤ 128, nome ≤ 120 —
 * com mensagens de validação em pt-BR (422 via pipe global).
 */

type Details = Array<{ field: string; issue: string }>;

const pipe = createGlobalValidationPipe();

function bodyMeta(metatype: ArgumentMetadata['metatype']): ArgumentMetadata {
  return { type: 'body', metatype, data: undefined };
}

async function expectValidationDetails(
  metatype: ArgumentMetadata['metatype'],
  value: unknown,
): Promise<Details> {
  let caught: unknown;
  try {
    await pipe.transform(value, bodyMeta(metatype));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(UnprocessableEntityException);
  const body = (caught as UnprocessableEntityException).getResponse() as { details: Details };
  return body.details;
}

describe('DTOs (unit) — regressão de @MaxLength com mensagens pt-BR', () => {
  const nome120 = 'n'.repeat(120);
  const nome121 = 'n'.repeat(121);
  const senha128 = 's'.repeat(128);
  const senha129 = 's'.repeat(129);

  describe('RegisterDto', () => {
    it('senha com 129 caracteres → 422 com mensagem pt-BR em details[].field = senha', async () => {
      const details = await expectValidationDetails(RegisterDto, {
        nome: 'Aluno',
        email: 'aluno@guia.test',
        senha: senha129,
      });
      expect(details).toEqual(
        expect.arrayContaining([
          { field: 'senha', issue: 'senha deve ter no máximo 128 caracteres' },
        ]),
      );
    });

    it('nome com 121 caracteres → 422 com mensagem pt-BR em details[].field = nome', async () => {
      const details = await expectValidationDetails(RegisterDto, {
        nome: nome121,
        email: 'aluno@guia.test',
        senha: 'senha-valida-1',
      });
      expect(details).toEqual(
        expect.arrayContaining([
          { field: 'nome', issue: 'nome deve ter no máximo 120 caracteres' },
        ]),
      );
    });

    it('limites exatos passam: nome com 120 e senha com 128 caracteres → aceito', async () => {
      await expect(
        pipe.transform(
          { nome: nome120, email: 'aluno@guia.test', senha: senha128 },
          bodyMeta(RegisterDto),
        ),
      ).resolves.toMatchObject({ nome: nome120, senha: senha128 });
    });
  });

  describe('ResetPasswordDto', () => {
    it('senhaNova com 129 caracteres → 422 com mensagem pt-BR', async () => {
      const details = await expectValidationDetails(ResetPasswordDto, {
        token: 'algum-token',
        senhaNova: senha129,
      });
      expect(details).toEqual(
        expect.arrayContaining([
          { field: 'senhaNova', issue: 'senhaNova deve ter no máximo 128 caracteres' },
        ]),
      );
    });
  });

  describe('ChangePasswordDto', () => {
    it('senhaNova com 129 caracteres → 422 com mensagem pt-BR', async () => {
      const details = await expectValidationDetails(ChangePasswordDto, {
        senhaAtual: 'senha-atual-1',
        senhaNova: senha129,
      });
      expect(details).toEqual(
        expect.arrayContaining([
          { field: 'senhaNova', issue: 'senhaNova deve ter no máximo 128 caracteres' },
        ]),
      );
    });
  });

  describe('UpdateMeDto', () => {
    it('nome com 121 caracteres → 422 com mensagem pt-BR', async () => {
      const details = await expectValidationDetails(UpdateMeDto, { nome: nome121 });
      expect(details).toEqual(
        expect.arrayContaining([
          { field: 'nome', issue: 'nome deve ter no máximo 120 caracteres' },
        ]),
      );
    });
  });
});

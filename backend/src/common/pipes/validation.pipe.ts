import { UnprocessableEntityException, ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorDetail } from '../errors/error-codes';

function flattenValidationErrors(errors: ValidationError[], parentPath = ''): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((issue) => ({ field, issue }));
    const nested = error.children?.length ? flattenValidationErrors(error.children, field) : [];
    return [...own, ...nested];
  });
}

export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) =>
      new UnprocessableEntityException({
        message: 'Dados de entrada inválidos.',
        details: flattenValidationErrors(errors),
      }),
  });
}

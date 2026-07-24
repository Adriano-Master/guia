import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode, ErrorDetail, ErrorEnvelope } from '../errors/error-codes';
import { RequestWithTraceId } from '../middleware/trace-id.middleware';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = (request as RequestWithTraceId).traceId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno inesperado.';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      // Convenção da API: erros de validação/entrada são sempre 422, nunca 400.
      if (status === HttpStatus.BAD_REQUEST) {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
      }

      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const typed = body as { message?: string | string[]; details?: ErrorDetail[] };
        message = Array.isArray(typed.message)
          ? typed.message.join('; ')
          : (typed.message ?? exception.message);
        details = typed.details;
      }
    }

    // Todo 5xx é logado com traceId — inclusive HttpException (ex.: 500/502
    // lançados explicitamente), não só erros não tratados.
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          traceId,
          status,
          method: request.method,
          path: request.url,
          error: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );
    }

    const code = STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL;

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
        traceId,
      },
    };

    response.status(status).json(envelope);
  }
}

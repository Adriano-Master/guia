import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const TRACE_ID_HEADER = 'x-trace-id';

export interface RequestWithTraceId extends Request {
  traceId: string;
}

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = randomUUID();
  (req as RequestWithTraceId).traceId = traceId;
  res.setHeader(TRACE_ID_HEADER, traceId);
  next();
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();

    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;

    // body-parser errors (e.g. 413 payload too large, 400 malformed JSON) are
    // plain errors with a 4xx `status`; keep it instead of reporting a 500.
    const bodyParserStatus = bodyParserErrorStatus(exception);

    const statusCode = isHttpException
      ? exception.getStatus()
      : (bodyParserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);

    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : bodyParserStatus === HttpStatus.PAYLOAD_TOO_LARGE
        ? 'Request body is too large'
        : bodyParserStatus
          ? 'Malformed request body'
          : 'Internal server error';

    let message = 'Internal server error';
    // Optional stable error code (e.g. SALESHANDY_AUTH_FAILED); additive field.
    let code: string | undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      const responseObject = exceptionResponse as Record<string, unknown>;

      message = Array.isArray(responseObject.message)
        ? pickValidationMessage(responseObject.message)
        : String(responseObject.message);
      if (typeof responseObject.code === 'string') {
        code = responseObject.code;
      }
    }

    response.status(statusCode).json({
      success: false,
      statusCode,
      message,
      ...(code ? { code } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

/** "Required" errors explain a missing field better than length/format ones. */
const REQUIRED_MESSAGE = /required|should not be empty|must be defined/i;

export function pickValidationMessage(messages: unknown[]): string {
  const list = messages.map(String);
  return list.find((m) => REQUIRED_MESSAGE.test(m)) ?? list[0] ?? 'Bad Request';
}

/** Status of a body-parser error (`{ type: 'entity.too.large', status: 413 }`), if any. */
export function bodyParserErrorStatus(exception: unknown): number | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const { status, type } = exception as { status?: unknown; type?: unknown };
  return typeof type === 'string' &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
    ? status
    : undefined;
}

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

    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? exception.getResponse()
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

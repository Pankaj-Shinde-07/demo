import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode: number;
    let messages: string[];
    let error: string;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        messages = [exceptionResponse];
        error = exception.name;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, any>;
        messages = Array.isArray(resp.message) ? resp.message : [resp.message || exception.message];
        error = resp.error || exception.name;
      } else {
        messages = [exception.message];
        error = exception.name;
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      messages = ['Internal server error'];
      error = 'InternalServerError';
    }

    const logPayload = {
      statusCode,
      path: request.url,
      method: request.method,
    };

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${statusCode}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify(logPayload),
      );
    } else if (statusCode >= 400) {
      this.logger.warn(
        `${request.method} ${request.url} ${statusCode} - ${messages.join(', ')}`,
      );
    }

    response.status(statusCode).json({
      success: false,
      statusCode,
      message: messages,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

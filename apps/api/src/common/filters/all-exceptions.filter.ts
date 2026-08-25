import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.message;
      this.logger.error(`HttpException: ${status} - ${message}`);
      response.status(status).json({
        statusCode: status,
        message,
      });
    } else {
      const err = exception as Error;
      this.logger.error(
        `Unhandled exception: ${err?.message || 'Unknown error'}\n${err?.stack || ''}`,
      );
      response.status(500).json({
        statusCode: 500,
        message: 'Internal server error',
      });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { winstonConfig } from './winston.config';

@Injectable()
export class LoggerService {
  log(message: string, context?: string) {
    winstonConfig.info({
      context,
      message,
    });
  }

  error(message: string, trace?: string, context?: string) {
    winstonConfig.error({
      context,
      message,
      trace,
    });
  }

  warn(message: string, context?: string) {
    winstonConfig.warn({
      context,
      message,
    });
  }

  debug(message: string, context?: string) {
    winstonConfig.debug({
      context,
      message,
    });
  }
}

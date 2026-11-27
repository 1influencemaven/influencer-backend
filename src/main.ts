import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { configureSwagger } from './config/swagger.config';

async function bootstrap() {
  // Body parsers are registered manually so only the CSV import accepts large
  // payloads (up to 5,000 mapped rows); every other route keeps a small limit.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use('/api/v1/prospects/import-csv', json({ limit: '10mb' }));
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  const configService = app.get(ConfigService);
  app.enableShutdownHooks();

  Logger.log(
    'IBP uses AiExecutionPublisher → influencer-ai (Mastra); no in-process AiService fallback',
    'Bootstrap',
  );

  if (configService.get('SWAGGER_ENABLED')) {
    configureSwagger(app);
  }

  const frontendUrl = configService.get<string>('FRONTEND_URL');

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // < 1 KB → no comprimir
  // > 1 KB → comprimir

  app.use(
    compression({
      threshold: 1024,
    }),
  );

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}
bootstrap();

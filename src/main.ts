import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const frontendUrl = configService.get<string>('FRONTEND_URL');

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

  const port = configService.get<string>('PORT') || process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();

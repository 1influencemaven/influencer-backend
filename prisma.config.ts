// Prisma CLI config — runs outside NestJS, so dotenv is required here.
// The NestJS app uses ConfigModule instead (see src/config/database.config.ts).
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load key=value pairs into process.env without overriding existing vars.
 * Nest uses @nestjs/config for the API process; this worker is plain Node and
 * must load the same influencer-backend/.env explicitly.
 */
export function loadDotEnvFiles(paths: string[]): string[] {
  const loaded: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    loaded.push(path);
  }
  return loaded;
}

/** Prefer backend root .env (Nest), then cwd .env. */
export function loadInfluencerAiDotEnv(): string[] {
  const candidates = [
    resolve(__dirname, '../../../.env'), // packages/influencer-ai/src|dist → backend root
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  return loadDotEnvFiles(candidates);
}

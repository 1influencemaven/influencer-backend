import { loadInfluencerAiDotEnv } from './config/load-dotenv';
import { startInfluencerAiWorker } from './worker/start-worker';

async function main(): Promise<void> {
  const loadedEnvFiles = loadInfluencerAiDotEnv();
  console.log(
    JSON.stringify({
      event: 'influencer_ai_env_loaded',
      files: loadedEnvFiles,
      brightDataConfigured: Boolean(
        process.env.BRIGHTDATA_API_KEY?.trim() &&
          process.env.BRIGHTDATA_SERP_ZONE?.trim(),
      ),
    }),
  );

  const started = await startInfluencerAiWorker();

  const shutdown = async (signal: string) => {
    console.log(
      JSON.stringify({ event: 'influencer_ai_worker_shutdown', signal }),
    );
    await started.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'influencer_ai_worker_boot_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

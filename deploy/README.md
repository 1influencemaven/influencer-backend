# Production deploy (teliot.site VPS)

Influence Maven runs on a shared VPS together with unrelated apps. The live compose
file is `/home/luis/srv/projects/teliot.site/docker-compose.yml`, which is **not
versioned**. `deploy/docker-compose.influencer.yml` mirrors its Influencer services.
When you change the server file, update the mirror in the same PR.

| Container | Image / build | Notes |
|---|---|---|
| `influencer-backend` | build `./influencer-backend` → `teliotsite-influencer-backend` | Runs `prisma migrate deploy` on start |
| `influencer-ai` | same image, `npm run start:influencer-ai` | Mastra worker; does **not** hot-reload |
| `influencer-frontend` | build `./influencer-frontend` | Next.js |
| `influencer-postgres`, `influencer-redis` | official images | Internal network only |
| `ollama` | `ollama/ollama` | Bound to `127.0.0.1:11434`: never publish it (no auth) |

## Configuration

Secrets live only in the server's `.env` as `INFLUENCERS_*` variables. The compose
file maps them to the app's variable names. Do not commit that file.

| Variable on the server | Production value / notes |
|---|---|
| `INFLUENCERS_AI_PROVIDER` | `anthropic`; set it to `ollama` to fall back to the local model |
| `INFLUENCERS_ANTHROPIC_MODEL` | `claude-haiku-5-5` |
| `INFLUENCERS_ANTHROPIC_API_KEY` | API key with credit |
| `INFLUENCERS_OLLAMA_MODEL` | `llama3.2:3b`, the fallback only. The host is CPU-only, so it is too slow for Brand Discovery |
| `INFLUENCERS_BRAND_DISCOVERY_PLAN_TIMEOUT_MS` | `300000` |
| `INFLUENCERS_BRAND_DISCOVERY_RESEARCH_CONCURRENCY` | `5` |
| `INFLUENCERS_SALESHANDY_*` | see `.env.example` |

## Deploy

Run these on the server, in `/home/luis/srv/projects/teliot.site`.

```bash
# 1. Update code (keep the server checkouts clean: no local edits)
git -C influencer-backend pull --ff-only origin main
git -C influencer-frontend pull --ff-only origin main

# 2. Keep a rollback image
docker tag teliotsite-influencer-backend:latest teliotsite-influencer-backend:rollback-$(date +%F)

# 3. Build and restart only Influencer services
docker compose build influencer-backend      # also used by influencer-ai
docker compose up -d --no-deps influencer-backend influencer-ai
# frontend changes:
docker compose build influencer-frontend && docker compose up -d --no-deps influencer-frontend

# 4. Check
docker logs --since 2m influencer-backend | grep -E "migrat|successfully started"
docker logs --since 2m influencer-ai | grep worker_started   # shows provider + model
curl -s https://influencers.teliot.site/api/v1/health
```

Changing only `.env` or compose variables does not need a rebuild. Recreate the
containers instead:
`docker compose up -d --no-deps influencer-backend influencer-ai`.

## Rollback

```bash
docker tag teliotsite-influencer-backend:rollback-YYYY-MM-DD teliotsite-influencer-backend:latest
docker compose up -d --no-deps influencer-backend influencer-ai
```

Migrations are forward-only. A rollback image runs against the migrated
database, so check that the older code tolerates the new columns.

## Notes

- The `docker-compose.yml` on the server uses CRLF line endings. When you edit it
  with `sed`, match the trailing `\r`.
- Back up `.env` and `docker-compose.yml` (`*.bak-YYYY-MM-DD`) before editing them.

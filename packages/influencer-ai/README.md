# `@influence-maven/influencer-ai`

Worker Mastra independiente (AI-003.2). Consume `ai.execution.requests` y publica `ai.execution.results` / `ai.execution.events`.

**Sin Prisma.** Contratos: `@influence-maven/ai-contracts`.

## Capacidades

| Capacidad | Estado |
|-----------|--------|
| IBP_GENERATION | Operativa |
| Brand / Lead / Contact Research | Pendiente |

## Arranque

Desde `influencer-backend/`:

```bash
npm install
npm run build -w @influence-maven/ai-contracts
npm run build -w @influence-maven/influencer-ai
npm run start:influencer-ai
```

Dev (tsx):

```bash
npm run start:influencer-ai:dev
```

## Variables

Reutiliza las del backend:

- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- `AI_PROVIDER=ollama|anthropic`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

## Feature flag Nest

Nest publica siempre `AiExecutionRequest` para IBP (AI-003.3; sin fallback `AiService`). Este worker debe estar en marcha.

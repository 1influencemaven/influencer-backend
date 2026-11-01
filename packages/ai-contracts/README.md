# `@influence-maven/ai-contracts`

Contratos compartidos v1.0 NestJS ↔ `influencer-ai` (AI-002 / AI-003.1).

Normativa: [`docs/arquitectura/ai-communication-contracts.md`](../../../docs/arquitectura/ai-communication-contracts.md).

Ejecutar desde la raíz de `influencer-backend` (npm workspaces):

```bash
npm run build:ai-contracts
npm run test:ai-contracts
```

Uso desde Nest:

```ts
import {
  parseAiExecutionRequest,
  AI_CONTRACT_VERSION,
} from '@influence-maven/ai-contracts';
```

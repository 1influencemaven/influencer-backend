/**
 * Local smoke: build PLAN prompts for two synthetic IBPs and optionally call Ollama.
 * Does not call Bright Data. No .env mutation.
 *
 * Usage (from packages/influencer-ai):
 *   npx tsx src/scripts/plan-search-prompt-smoke.ts
 *   npx tsx src/scripts/plan-search-prompt-smoke.ts --call-llm
 */
import { buildBrandDiscoveryPlanUserPrompt } from '../prompts/brand-discovery-plan.prompt';

const techIbp = {
  targetSectors: ['consumer electronics', 'hardware accessories'],
  excludedSectors: ['gambling'],
  brandSize: ['smb', 'mid-market'],
  markets: ['Europe', 'Spain'],
  collaborationTypes: ['affiliate', 'product seeding'],
  summary: 'Tech review creators focused on gadgets for EU SMB brands',
  alertSignals: ['crypto giveaways'],
  desirableCriteria: ['creator program', 'EU shipping'],
};

const wellnessIbp = {
  targetSectors: ['wellness', 'sportswear'],
  excludedSectors: ['alcohol', 'tobacco'],
  brandSize: ['smb'],
  markets: ['LatAm', 'Mexico'],
  collaborationTypes: ['brand ambassador', 'sponsorship'],
  summary: 'Fitness lifestyle creators for regional wellness brands',
  alertSignals: ['miracle claims'],
  desirableCriteria: ['sustainability'],
};

type Case = {
  label: string;
  influencerName: string;
  niche: string;
  ibp: typeof techIbp;
};

const cases: Case[] = [
  {
    label: 'tech-hardware',
    influencerName: 'Solusat',
    niche: 'consumer tech reviews',
    ibp: techIbp,
  },
  {
    label: 'wellness-fitness',
    influencerName: 'Maria Fit',
    niche: 'fitness lifestyle',
    ibp: wellnessIbp,
  },
];

function countNameHits(queries: string[], name: string): number {
  const lower = name.toLowerCase();
  return queries.filter((q) => q.toLowerCase().includes(lower)).length;
}

function evaluateQueries(
  label: string,
  influencerName: string,
  ibp: typeof techIbp,
  queries: string[],
): void {
  const nameHits = countNameHits(queries, influencerName);
  const sectorHit = queries.some((q) =>
    ibp.targetSectors.some((s) => {
      const token = s.toLowerCase().split(/\s+/)[0];
      return token ? q.toLowerCase().includes(token) : false;
    }),
  );
  const marketHit = queries.some((q) =>
    ibp.markets.some((m) => q.toLowerCase().includes(m.toLowerCase())),
  );
  const commercialHit = queries.some((q) =>
    /partner|affiliate|sponsor|ambassador|creator|influencer marketing|collaboration/i.test(
      q,
    ),
  );

  console.log(`\n=== LLM output: ${label} ===`);
  console.log(`queries (${queries.length}):`);
  for (const q of queries) {
    console.log(`  - ${q}`);
  }
  console.log(
    JSON.stringify(
      {
        queryCount: queries.length,
        maxOk: queries.length <= 4 && queries.length >= 1,
        influencerNameHits: nameHits,
        nameQuotaOk: nameHits <= 1,
        mentionsSectorToken: sectorHit,
        mentionsMarketToken: marketHit,
        mentionsCommercialSignal: commercialHit,
        note: 'Heuristic checks on LLM output — not a unit-test guarantee',
      },
      null,
      2,
    ),
  );
}

async function callOllama(prompt: string): Promise<string[]> {
  const baseUrl = (
    process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nRespond with JSON only matching {"queries":["..."]}.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    message?: { content?: string };
  };
  const text = body.message?.content?.trim() ?? '';
  const parsed = JSON.parse(text) as { queries?: unknown };
  if (!Array.isArray(parsed.queries)) {
    throw new Error(`Unexpected Ollama JSON: ${text.slice(0, 200)}`);
  }
  return parsed.queries
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, 4);
}

async function ollamaAvailable(): Promise<boolean> {
  const baseUrl = (
    process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const callLlm = process.argv.includes('--call-llm');

  for (const c of cases) {
    const prompt = buildBrandDiscoveryPlanUserPrompt({
      influencerName: c.influencerName,
      niche: c.niche,
      ibp: c.ibp,
      maxQueries: 4,
    });

    console.log(
      `\n--- prompt built for ${c.label} (${prompt.length} chars) ---`,
    );
    console.log(`  TARGET SECTORS: ${prompt.includes('TARGET SECTORS')}`);
    console.log(`  MARKETS: ${prompt.includes('MARKETS')}`);
    console.log(`  Prefer ZERO: ${/Prefer ZERO queries/i.test(prompt)}`);
    console.log(`  At most ONE: ${/At most ONE query/i.test(prompt)}`);

    if (!callLlm) {
      console.log('  (skip LLM — pass --call-llm to invoke Ollama)');
      continue;
    }

    if (!(await ollamaAvailable())) {
      console.log('  Ollama not reachable — skip LLM smoke');
      continue;
    }

    try {
      const queries = await callOllama(prompt);
      evaluateQueries(c.label, c.influencerName, c.ibp, queries);
    } catch (error) {
      console.error(
        `LLM smoke failed for ${c.label}:`,
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    }
  }
}

void main();

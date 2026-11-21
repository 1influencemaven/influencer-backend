/**
 * Controlled PLAN_SEARCH smoke for Diana Marcoccia IBP (Ollama).
 * No Bright Data, no RESEARCH, no DB writes.
 *
 * Usage (from packages/influencer-ai):
 *   npx tsx src/scripts/diana-plan-search-smoke.ts
 *   npx tsx src/scripts/diana-plan-search-smoke.ts --call-llm
 */
import { buildBrandDiscoveryPlanUserPrompt } from '../prompts/brand-discovery-plan.prompt';

const dianaIbp = {
  targetSectors: ['entrepreneurship', 'maternity', 'personal_development'],
  excludedSectors: ['alcohol', 'gambling'],
  brandSize: ['smb', 'startup'],
  markets: ['LATAM', 'United States'],
  collaborationTypes: ['brand ambassador', 'UGC'],
  summary:
    'Diana Marcoccia is an entrepreneur and mother, focusing on personal development and maternidad, making her ideal for brands targeting the Latina entrepreneur and mother audience.',
  alertSignals: ['Limited verified content'],
  desirableCriteria: [
    'Hashtags related to personal development and entrepreneurship',
  ],
};

const maxQueries = 4;

const prompt = buildBrandDiscoveryPlanUserPrompt({
  influencerName: 'Diana Marcoccia',
  niche: null,
  subNiche: null,
  niches: ['Mama emprendedora', 'maternidad', 'mindset latina', 'CEO'],
  country: null,
  language: null,
  followers: 399591,
  engagement: null,
  ibp: dianaIbp,
  maxQueries,
});

async function callOllama(userPrompt: string): Promise<string[]> {
  const baseUrl = (
    process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';

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
          content: `${userPrompt}\n\nRespond with JSON only matching {"queries":["..."]}.`,
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
    .slice(0, maxQueries);
}

/** Mirror Nest collaboration-mode quota (keep script dependency-free). */
function validateLikeNest(queries: string[]): string[] {
  const mode =
    /\b(ugc|brand\s+ambassadors?|ambassadors?|affiliates?|partnerships?|influencer\s+marketing|creator\s+programs?)\b/i;
  const company =
    /\b(companies|company|products?|services?|dtc|shops?|stores?)\b|\bbrands?\b(?!\s+ambassadors?)/i;
  const kept: string[] = [];
  let modeKept = 0;
  for (const q of queries) {
    if (!mode.test(q)) {
      kept.push(q);
      continue;
    }
    if (mode.test(q) && !company.test(q)) continue;
    if (modeKept >= 1) continue;
    kept.push(q);
    modeKept += 1;
  }
  return kept.slice(0, maxQueries);
}

async function main(): Promise<void> {
  const callLlm = process.argv.includes('--call-llm');

  console.log('=== PLAN prompt length ===', prompt.length);
  console.log('=== niches wired ===', prompt.includes('Mama emprendedora'));
  console.log(
    '=== product-first instructions ===',
    /PRIORITY \(highest first\)/i.test(prompt),
  );

  if (!callLlm) {
    console.log('Pass --call-llm to generate queries via Ollama.');
    return;
  }

  const queries = await callOllama(prompt);
  const validated = validateLikeNest(queries);

  console.log('=== Raw LLM queries ===');
  console.log(JSON.stringify(queries, null, 2));
  console.log('=== After Nest-like validation ===');
  console.log(JSON.stringify(validated, null, 2));
  console.log(
    '=== mode mentions (raw) ===',
    queries.filter((q) =>
      /\b(ugc|ambassador|affiliate|partnerships?)\b/i.test(q),
    ).length,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

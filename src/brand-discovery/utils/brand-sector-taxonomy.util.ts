/**
 * Concrete product subcategories behind the abstract sectors an IBP carries
 * ("beauty", "fashion", "home decor", "lifestyle"…). SERP queries built from an
 * abstract sector return listicles and retailers; queries built from a concrete
 * subcategory ("candles", "swimwear") return brand sites.
 *
 * Deterministic and offline: no LLM involved.
 */
type TaxonomyGroup = {
  /** Stable canonical niche slug (Brand Knowledge Base `nicheKey`). */
  key: string;
  match: RegExp;
  subcategories: readonly string[];
};

const TAXONOMY: readonly TaxonomyGroup[] = [
  {
    key: 'beauty',
    match:
      /\b(beauty|skincare|skin\s*care|makeup|cosmetics?|belleza|maquillaje|cuidado\s+de\s+la\s+piel)\b/i,
    subcategories: [
      'skincare',
      'makeup',
      'haircare',
      'fragrance',
      'nail polish',
      'body care',
      'beauty tools',
    ],
  },
  {
    key: 'fashion',
    match:
      /\b(fashion|moda|clothing|apparel|style|estilo|outfits?|ropa|vestidos?)\b/i,
    subcategories: [
      'womens clothing',
      'activewear',
      'swimwear',
      'jewelry',
      'handbags',
      'shoes',
      'sunglasses',
      'lingerie',
    ],
  },
  {
    key: 'home-decor',
    match:
      /\b(home\s*decor|decor|decoraci[oó]n|home|hogar|remodel\w*|interiors?|diy)\b/i,
    subcategories: [
      'candles',
      'wall art',
      'bedding',
      'area rugs',
      'lighting',
      'furniture',
      'kitchenware',
      'storage organizers',
      'planters',
    ],
  },
  {
    key: 'family',
    match:
      /\b(mama|mamá|mom|moms|mother|family|familia|kids?|children|baby|maternity|parent(ing)?|ni[ñn]os)\b/i,
    subcategories: [
      'baby products',
      'kids clothing',
      'toys',
      'diapers',
      'kids snacks',
      'maternity clothing',
    ],
  },
  {
    key: 'fitness',
    match:
      /\b(fitness|workout|gym|wellness|health|salud|bienestar|yoga|sauna)\b/i,
    subcategories: [
      'activewear',
      'protein supplements',
      'yoga mats',
      'vitamins',
      'fitness equipment',
      'wellness drinks',
    ],
  },
  {
    key: 'travel',
    match: /\b(travel|viajes?|luggage|trips?)\b/i,
    subcategories: ['luggage', 'travel accessories', 'travel gear'],
  },
  {
    key: 'food',
    match:
      /\b(food|restaurants?|cooking|recipes?|comida|snacks?|coffee|drinks?|beverages?)\b/i,
    subcategories: [
      'snack brands',
      'coffee',
      'beverages',
      'meal kits',
      'kitchen gadgets',
    ],
  },
  {
    key: 'pets',
    match: /\b(pets?|dogs?|cats?|mascotas?)\b/i,
    subcategories: ['pet food', 'pet accessories', 'pet toys'],
  },
  {
    key: 'deals-gadgets',
    match: /\b(amazon|tiktok\s*shop|deals|ofertas|gadgets?)\b/i,
    subcategories: [
      'kitchen gadgets',
      'home organization',
      'cleaning products',
      'phone accessories',
      'beauty tools',
    ],
  },
  {
    key: 'tech',
    match: /\b(tech|technology|tecnolog\w*|electronics?)\b/i,
    subcategories: [
      'smart home devices',
      'phone accessories',
      'headphones',
      'small appliances',
    ],
  },
  {
    key: 'lifestyle',
    match: /\b(lifestyle)\b/i,
    subcategories: [
      'planners and stationery',
      'water bottles',
      'tote bags',
      'home fragrance',
      'self care gifts',
    ],
  },
];

/** Tokens that carry no product meaning on their own. */
const ABSTRACT_ONLY = new Set([
  'personal',
  'development',
  'mindset',
  'business',
  'entrepreneurship',
  'entrepreneur',
  'comedy',
  'events',
  'entertainment',
  'review',
  'reviews',
  'latina',
  'latino',
  'ceo',
  'finanzas',
  'finance',
]);

function normalizeTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ');
}

/**
 * Expands abstract sectors / niches into concrete product subcategories.
 * Groups are interleaved round-robin so the first results span every sector
 * instead of exhausting the first one. A term that matches no group is kept as
 * its own subcategory only when it already looks concrete (not abstract-only).
 */
export function expandSectorsToSubcategories(
  terms: ReadonlyArray<string>,
  max = 12,
): string[] {
  const groups: string[][] = [];
  const passthrough: string[] = [];
  const usedGroups = new Set<TaxonomyGroup>();

  for (const raw of terms) {
    const term = normalizeTerm(raw ?? '');
    if (!term) continue;

    const matched = TAXONOMY.filter((group) => group.match.test(term));
    if (matched.length === 0) {
      const tokens = term.toLowerCase().split(/\s+/);
      if (!tokens.every((token) => ABSTRACT_ONLY.has(token))) {
        passthrough.push(term.toLowerCase());
      }
      continue;
    }
    for (const group of matched) {
      if (usedGroups.has(group)) continue;
      usedGroups.add(group);
      groups.push([...group.subcategories]);
    }
  }
  if (passthrough.length > 0) {
    groups.unshift(passthrough);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest && result.length < max; i += 1) {
    for (const group of groups) {
      const candidate = group[i];
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
      if (result.length >= max) break;
    }
  }
  return result;
}

/** Version of the niche vocabulary; bump when keys/groups change (BKB reindex). */
export const NICHE_TAXONOMY_VERSION = 1;

export type ResolvedNicheKeys = {
  nicheKeys: string[];
  /** Concrete-looking terms no group recognises (telemetry for taxonomy growth). */
  unmappedTerms: string[];
};

/**
 * Maps free-form niche / sector terms to canonical, stable niche keys
 * (`beauty`, `home-decor`, …). Unlike `expandSectorsToSubcategories` this does
 * NOT explode a broad term into subcategories and never lets free text through:
 * unrecognised terms are reported in `unmappedTerms`, abstract-only ones dropped.
 */
export function resolveNicheKeys(
  terms: ReadonlyArray<string | null | undefined>,
): ResolvedNicheKeys {
  const keys = new Set<string>();
  const unmapped = new Set<string>();
  for (const raw of terms) {
    const term = normalizeTerm(raw ?? '');
    if (!term) continue;
    const matched = TAXONOMY.filter((group) => group.match.test(term));
    if (matched.length > 0) {
      for (const group of matched) keys.add(group.key);
      continue;
    }
    const tokens = term.toLowerCase().split(/\s+/);
    if (!tokens.every((token) => ABSTRACT_ONLY.has(token))) {
      unmapped.add(term.toLowerCase());
    }
  }
  return { nicheKeys: [...keys], unmappedTerms: [...unmapped] };
}

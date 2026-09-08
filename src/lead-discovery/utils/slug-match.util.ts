export function normalizeNameToSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugSimilarityScore(expectedSlug: string, actualSlug: string): number {
  const a = expectedSlug.toLowerCase();
  const b = actualSlug.toLowerCase();
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (b.includes(a) || a.includes(b)) {
    return 0.85;
  }
  const aTokens = a.split('-').filter(Boolean);
  const bTokens = b.split('-').filter(Boolean);
  const overlap = aTokens.filter((t) => bTokens.includes(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? overlap / union : 0;
}

const PRIORITY_PATTERNS: RegExp[] = [
  /influencer\s*marketing/i,
  /partnership/i,
  /sponsor/i,
  /collaboration/i,
  /\bcmo\b/i,
  /brand\s*manager/i,
  /marketing\s*manager/i,
  /head\s+of\s+digital/i,
  /\bceo\b/i,
  /founder/i,
  /\bpr\b/i,
  /comunicaci[oó]n/i,
  /communications/i,
];

export function titlePriorityScore(title?: string | null): number {
  if (!title?.trim()) {
    return PRIORITY_PATTERNS.length + 1;
  }
  const index = PRIORITY_PATTERNS.findIndex((pattern) => pattern.test(title));
  return index === -1 ? PRIORITY_PATTERNS.length : index;
}

export function sortContactsByTitlePriority<
  T extends { title?: string | null; isGeneric?: boolean },
>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => {
    if (Boolean(a.isGeneric) !== Boolean(b.isGeneric)) {
      return a.isGeneric ? 1 : -1;
    }
    return titlePriorityScore(a.title) - titlePriorityScore(b.title);
  });
}

const MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseExpiresInToMs(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);

  if (!match) {
    throw new Error(`Invalid expires in format: ${expiresIn}`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  return value * MULTIPLIERS[unit];
}

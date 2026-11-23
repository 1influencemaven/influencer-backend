/**
 * Multi-brand retailers (department stores, big-box, beauty chains). They sell
 * other brands' products, so for a creator collaboration they are low-value
 * candidates, yet the scorer ranks them at the top. Under a run limit they
 * displaced brand-owned candidates (4 of 10 persisted in one measured run).
 *
 * Brand-owned retailers (a DTC brand's own store) are NOT listed here.
 */
const MULTI_BRAND_RETAILERS = new Set([
  'sephora.com',
  'ulta.com',
  'nordstrom.com',
  'nordstromrack.com',
  'macys.com',
  'bloomingdales.com',
  'saksfifthavenue.com',
  'neimanmarcus.com',
  'target.com',
  'walmart.com',
  'costco.com',
  'kohls.com',
  'jcpenney.com',
  'dillards.com',
  'belk.com',
  'tjmaxx.com',
  'marshalls.com',
  'ross.com',
  'burlington.com',
  'bestbuy.com',
  'homedepot.com',
  'lowes.com',
  'cvs.com',
  'walgreens.com',
  'riteaid.com',
  'bedbathandbeyond.com',
  'wayfair.com',
  'zappos.com',
  'dsw.com',
  'asos.com',
  'revolve.com',
  'shopbop.com',
  'bluemercury.com',
  'dermstore.com',
  'sallybeauty.com',
  'lookfantastic.com',
  'cultbeauty.com',
]);

export type RetailerPolicy = 'demote' | 'exclude' | 'off';

export function parseRetailerPolicy(raw: unknown): RetailerPolicy {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === 'exclude' || value === 'off' ? value : 'demote';
}

/** True for the retailer's domain or any subdomain (shop.nordstrom.com). */
export function isMultiBrandRetailer(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (MULTI_BRAND_RETAILERS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export type PersistenceSelection<T> = {
  selected: T[];
  /** Retailers that still made it into the selection (demote policy). */
  retailersSelected: T[];
  /** Retailers removed outright (exclude policy). */
  retailersExcluded: T[];
  /** Valid candidates that did not fit under the run limit. */
  cutByLimit: T[];
};

/**
 * Decides which candidates are persisted, in order:
 *  - `demote`  (default): brands first, retailers only fill the remaining slots.
 *  - `exclude`: retailers never persist.
 *  - `off`: keep the incoming order.
 * Incoming order (VERIFIED first, then model order) is preserved within groups.
 */
export function selectForPersistence<T extends { domain: string }>(
  ordered: T[],
  limit: number,
  policy: RetailerPolicy,
): PersistenceSelection<T> {
  let pool = ordered;
  let retailersExcluded: T[] = [];

  if (policy !== 'off') {
    const brands = ordered.filter((c) => !isMultiBrandRetailer(c.domain));
    const retailers = ordered.filter((c) => isMultiBrandRetailer(c.domain));
    if (policy === 'exclude') {
      pool = brands;
      retailersExcluded = retailers;
    } else {
      pool = [...brands, ...retailers];
    }
  }

  const selected = pool.slice(0, Math.max(0, limit));
  return {
    selected,
    retailersSelected: selected.filter((c) => isMultiBrandRetailer(c.domain)),
    retailersExcluded,
    cutByLimit: pool.slice(Math.max(0, limit)),
  };
}

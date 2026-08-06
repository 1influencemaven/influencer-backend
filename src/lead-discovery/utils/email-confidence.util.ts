import { LeadEmailConfidence } from '../../generated/prisma/enums';
import { isGenericEmail } from './generic-email.util';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function assessEmailConfidence(
  email: string,
  brandDomain: string,
): LeadEmailConfidence {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    return LeadEmailConfidence.INVALID;
  }

  const domain = normalized.split('@')[1] ?? '';
  const brand = brandDomain.replace(/^www\./, '').toLowerCase();

  if (isGenericEmail(normalized)) {
    return domain === brand || domain.endsWith(`.${brand}`)
      ? LeadEmailConfidence.DOUBTFUL
      : LeadEmailConfidence.DOUBTFUL;
  }

  if (domain === brand || domain.endsWith(`.${brand}`)) {
    const local = normalized.split('@')[0] ?? '';
    if (local.includes('.') || local.includes('_')) {
      return LeadEmailConfidence.VALID;
    }
    return LeadEmailConfidence.PROBABLE;
  }

  if (domain.includes(brand.split('.')[0] ?? '')) {
    return LeadEmailConfidence.DOUBTFUL;
  }

  return LeadEmailConfidence.UNKNOWN;
}

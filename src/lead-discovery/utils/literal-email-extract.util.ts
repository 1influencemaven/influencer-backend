const EMAIL_PATTERN =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g;

const MASKED_LOCAL_PART = /[*…]|\.{2,}|\[hidden\]/i;

export type LiteralEmailMatch = {
  email: string;
  evidenceSnippet: string;
};

export function decodeHtmlEntitiesForEmailScan(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&#0*62;/gi, '>')
    .replace(/&#0*60;/gi, '<')
    .replace(/&#0*64;/gi, '@')
    .replace(/&#x0*3e;/gi, '>')
    .replace(/&#x0*3c;/gi, '<')
    .replace(/&#x0*40;/gi, '@')
    .replace(/\\u003e/gi, '>')
    .replace(/\bu003e/gi, '')
    .replace(/&nbsp;/gi, ' ');
}

function isValidEmailStructure(email: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2) {
    return false;
  }
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64) {
    return false;
  }
  if (!domain.includes('.')) {
    return false;
  }
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (!/^[a-z]{2,63}$/i.test(tld)) {
    return false;
  }
  if (labels.some((label) => !label || label.length > 63)) {
    return false;
  }
  if (/^u[0-9a-f]{4}/i.test(local)) {
    return false;
  }
  return true;
}

export function isMaskedOrIncompleteEmail(email: string): boolean {
  const local = email.split('@')[0] ?? '';
  if (!local || !email.includes('@')) {
    return true;
  }
  if (MASKED_LOCAL_PART.test(local)) {
    return true;
  }
  if (local.endsWith('.') || local.startsWith('.')) {
    return true;
  }
  return false;
}

export function extractLiteralEmailsFromText(
  rawText: string,
  snippetRadius = 60,
): LiteralEmailMatch[] {
  const text = decodeHtmlEntitiesForEmailScan(rawText);
  const found = new Map<string, LiteralEmailMatch>();

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].trim();
    if (isMaskedOrIncompleteEmail(email)) {
      continue;
    }
    if (!isValidEmailStructure(email)) {
      continue;
    }
    const normalized = email.toLowerCase();
    if (found.has(normalized)) {
      continue;
    }
    const index = match.index ?? text.indexOf(email);
    if (index < 0) {
      continue;
    }
    const snippetStart = Math.max(0, index - snippetRadius);
    const snippetEnd = Math.min(
      text.length,
      index + email.length + snippetRadius,
    );
    const evidenceSnippet = text.slice(snippetStart, snippetEnd);
    if (
      !evidenceSnippet.includes(email) &&
      !evidenceSnippet.includes(normalized)
    ) {
      const caseInsensitive = evidenceSnippet
        .toLowerCase()
        .includes(normalized);
      if (!caseInsensitive) {
        continue;
      }
    }
    found.set(normalized, {
      email: normalized,
      evidenceSnippet,
    });
  }

  return [...found.values()];
}

export function emailLiteralInEvidence(
  email: string,
  evidenceSnippet: string,
): boolean {
  const normalized = email.toLowerCase();
  const decoded = decodeHtmlEntitiesForEmailScan(evidenceSnippet);
  return (
    decoded.includes(email) ||
    decoded.includes(normalized) ||
    decoded.toLowerCase().includes(normalized)
  );
}

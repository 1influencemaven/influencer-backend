import { CommercialRelevance } from '../../generated/prisma/enums';

import { classifyAndDedupeBbcEmails } from './classify-and-dedupe';
import { extractLiteralEmailObservations } from './literal-email.extractor';

describe('extractLiteralEmailObservations', () => {
  it('extracts literal emails with evidence and does not invent addresses', () => {
    const observations = extractLiteralEmailObservations({
      text: 'Write partnerships@brand.com or press@brand.com today',
      sourceUrl: 'https://brand.com/contact',
    });
    expect(observations.map((o) => o.email).sort()).toEqual([
      'partnerships@brand.com',
      'press@brand.com',
    ]);
    expect(observations.every((o) => o.evidenceSnippet.includes('@'))).toBe(
      true,
    );
    expect(
      extractLiteralEmailObservations({
        text: 'Contact us via the form only',
        sourceUrl: 'https://brand.com/contact',
      }),
    ).toEqual([]);
  });
});

describe('classifyAndDedupeBbcEmails', () => {
  const now = new Date('2026-10-29T12:00:00.000Z');

  it('keeps HIGH generic brand inboxes with evidence', () => {
    const result = classifyAndDedupeBbcEmails({
      brandDomain: 'brand.com',
      now,
      observations: [
        {
          email: 'info@brand.com',
          sourceUrl: 'https://brand.com/contact',
          evidenceSnippet: 'Reach info@brand.com',
        },
        {
          email: 'press@brand.com',
          sourceUrl: 'https://brand.com/press',
          evidenceSnippet: 'Media: press@brand.com',
        },
      ],
    });

    expect(result.accepted.map((c) => c.emailNormalized).sort()).toEqual([
      'info@brand.com',
      'press@brand.com',
    ]);
    expect(
      result.accepted.every(
        (c) =>
          c.commercialRelevance === CommercialRelevance.HIGH &&
          c.evidences.length === 1,
      ),
    ).toBe(true);
  });

  it('discards LOW relevance and external corporate domains', () => {
    const result = classifyAndDedupeBbcEmails({
      brandDomain: 'brand.com',
      now,
      observations: [
        {
          email: 'noreply@brand.com',
          sourceUrl: 'https://brand.com/',
          evidenceSnippet: 'noreply@brand.com',
        },
        {
          email: 'hello@agency-partner.io',
          sourceUrl: 'https://brand.com/contact',
          evidenceSnippet: 'hello@agency-partner.io',
        },
        {
          email: 'partnerships@brand.com',
          sourceUrl: 'https://brand.com/partnerships',
          evidenceSnippet: 'partnerships@brand.com',
        },
      ],
    });

    expect(result.accepted.map((c) => c.emailNormalized)).toEqual([
      'partnerships@brand.com',
    ]);
    expect(result.discardCountsByReason.low_relevance).toBe(1);
    expect(result.discardCountsByReason.external_domain).toBe(1);
  });

  it('dedupes by emailNormalized and merges evidences', () => {
    const result = classifyAndDedupeBbcEmails({
      brandDomain: 'brand.com',
      now,
      observations: [
        {
          email: 'Info@Brand.com',
          sourceUrl: 'https://brand.com/contact',
          evidenceSnippet: 'Info@Brand.com here',
        },
        {
          email: 'info@brand.com',
          sourceUrl: 'https://brand.com/about',
          evidenceSnippet: 'Also info@brand.com',
        },
      ],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.evidences).toHaveLength(2);
    expect(result.discardCountsByReason.duplicate).toBe(1);
  });

  it('allows free-mail as UNKNOWN with evidence (no ownership claim)', () => {
    const result = classifyAndDedupeBbcEmails({
      brandDomain: 'brand.com',
      now,
      observations: [
        {
          email: 'creator.manager@gmail.com',
          sourceUrl: 'https://brand.com/creators',
          evidenceSnippet: 'creator.manager@gmail.com',
        },
      ],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.commercialRelevance).toBe(
      CommercialRelevance.UNKNOWN,
    );
    expect(result.accepted[0]?.evidences[0]?.sourceUrl).toBe(
      'https://brand.com/creators',
    );
  });

  it('keeps multiple free-mail candidates when each has evidence', () => {
    const result = classifyAndDedupeBbcEmails({
      brandDomain: 'brand.com',
      now,
      observations: [
        {
          email: 'a@gmail.com',
          sourceUrl: 'https://brand.com/creators',
          evidenceSnippet: 'a@gmail.com',
        },
        {
          email: 'b@yahoo.com',
          sourceUrl: 'https://brand.com/influencers',
          evidenceSnippet: 'b@yahoo.com',
        },
      ],
    });
    expect(result.accepted.map((c) => c.emailNormalized).sort()).toEqual([
      'a@gmail.com',
      'b@yahoo.com',
    ]);
  });

  it('merges three evidence sources for the same repeated candidate', () => {
    const result = classifyAndDedupeBbcEmails({
      brandDomain: 'brand.com',
      now,
      observations: [
        {
          email: 'partnerships@brand.com',
          sourceUrl: 'https://brand.com/partnerships',
          evidenceSnippet: 'partnerships@brand.com on partnerships',
        },
        {
          email: 'Partnerships@Brand.com',
          sourceUrl: 'https://brand.com/contact',
          evidenceSnippet: 'email Partnerships@Brand.com',
        },
        {
          email: 'partnerships@brand.com',
          sourceUrl: 'https://brand.com/about',
          evidenceSnippet: 'also partnerships@brand.com',
        },
        {
          email: 'partnerships@brand.com',
          sourceUrl: 'https://brand.com/about',
          evidenceSnippet: 'also partnerships@brand.com',
        },
      ],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.evidences).toHaveLength(3);
    expect(result.discardCountsByReason.duplicate).toBe(3);
  });
});


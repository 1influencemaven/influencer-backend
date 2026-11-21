import {
  contactResearchInputSchema,
  contactResearchOutputSchema,
  contactResearchPageSnapshotSchema,
} from './contact-research';

describe('contact-research RF-04.3 contracts', () => {
  const snap = {
    url: 'https://brand.com/contact',
    normalizedUrl: 'https://brand.com/contact',
    fetchedAt: '2026-03-01T12:00:00.000Z',
    content: '<html>hello</html>',
    contentType: 'text/html',
    truncated: false,
    mailtoEmails: ['hello@brand.com'],
  };

  it('accepts pageSnapshots on FIND_BRAND_EMAILS output', () => {
    const parsed = contactResearchOutputSchema.safeParse({
      operation: 'FIND_BRAND_EMAILS',
      outcome: 'NO_MATCHES',
      emails: [],
      pageSnapshots: [snap],
      trace: {
        queries: [],
        pages: [snap.url],
        serpCalls: 0,
        pageCalls: 1,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts optional pageSnapshots on FIND_BRAND_PEOPLE input', () => {
    const withSnaps = contactResearchInputSchema.safeParse({
      operation: 'FIND_BRAND_PEOPLE',
      brandName: 'Brand',
      website: 'https://brand.com',
      domain: 'brand.com',
      pageSnapshots: [snap],
    });
    expect(withSnaps.success).toBe(true);

    const without = contactResearchInputSchema.safeParse({
      operation: 'FIND_BRAND_PEOPLE',
      brandName: 'Brand',
      website: 'https://brand.com',
      domain: 'brand.com',
    });
    expect(without.success).toBe(true);
  });

  it('accepts peeReuse on FIND_BRAND_PEOPLE trace', () => {
    const parsed = contactResearchOutputSchema.safeParse({
      operation: 'FIND_BRAND_PEOPLE',
      outcome: 'RESULTS_FOUND',
      people: [],
      trace: {
        queries: [],
        linkedinUrlsConsidered: [],
        profilesScraped: 0,
        serpCalls: 0,
        brandPagesFetched: 0,
        peeReuse: {
          snapshotsReceivedFrom2A: 2,
          peePagesReused: 1,
          peePagesFetchedUnlocker: 1,
          peePagesRejected: 0,
          unlockerCallsAvoided: 1,
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty snapshot content', () => {
    expect(
      contactResearchPageSnapshotSchema.safeParse({
        ...snap,
        content: '',
      }).success,
    ).toBe(false);
  });

  it('caps pageSnapshots at 4', () => {
    const many = [snap, snap, snap, snap, snap];
    const parsed = contactResearchOutputSchema.safeParse({
      operation: 'FIND_BRAND_EMAILS',
      outcome: 'NO_MATCHES',
      emails: [],
      pageSnapshots: many,
    });
    expect(parsed.success).toBe(false);
  });
});

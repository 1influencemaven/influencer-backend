import { aiExecutionRequestSchema } from '../request';
import { aiExecutionResultSchema } from '../result';
import {
  AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES,
  agencyContactEmailProvenanceSchema,
  agencyContactFoundEmailSchema,
  contactResearchFindAgencyEmailsInputSchema,
  contactResearchFindAgencyPeopleInputSchema,
  contactResearchInputSchema,
  contactResearchOutputSchema,
} from './contact-research';

describe('2C.4.1 Agency Contact Research contracts', () => {
  const agencyBase = {
    agencyId: 'agency-1',
    agencyName: 'Creator Partners SL',
    website: 'https://creatorpartners.example',
    domain: 'creatorpartners.example',
  };

  const snap = {
    url: 'https://creatorpartners.example/contact',
    normalizedUrl: 'https://creatorpartners.example/contact',
    fetchedAt: '2026-03-01T12:00:00.000Z',
    content: '<html>partnerships@creatorpartners.example</html>',
    truncated: false,
    mailtoEmails: ['partnerships@creatorpartners.example'],
  };

  describe('FIND_AGENCY_EMAILS input', () => {
    it('accepts minimal required fields and applies defaults', () => {
      const parsed = contactResearchInputSchema.safeParse({
        operation: 'FIND_AGENCY_EMAILS',
        ...agencyBase,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.operation === 'FIND_AGENCY_EMAILS') {
        expect(parsed.data.maxSerpQueries).toBe(5);
        expect(parsed.data.maxPages).toBe(5);
        expect(parsed.data.agencyId).toBe('agency-1');
      }
    });

    it('accepts optional influencer context and seedUrls', () => {
      const parsed = contactResearchFindAgencyEmailsInputSchema.safeParse({
        operation: 'FIND_AGENCY_EMAILS',
        ...agencyBase,
        niche: 'home',
        niches: ['home', 'lifestyle'],
        country: 'ES',
        markets: ['Spain', 'LATAM'],
        seedUrls: ['https://creatorpartners.example/contact'],
        maxSerpQueries: 3,
        maxPages: 4,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects missing agencyId / domain', () => {
      expect(
        contactResearchInputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          agencyName: 'X',
          website: 'https://x.example',
          domain: 'x.example',
        }).success,
      ).toBe(false);
      expect(
        contactResearchInputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          agencyId: 'a1',
          agencyName: 'X',
          website: 'https://x.example',
        }).success,
      ).toBe(false);
    });

    it('rejects brand-shaped payload as FIND_AGENCY_EMAILS', () => {
      expect(
        contactResearchInputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          brandName: 'Brand',
          website: 'https://brand.com',
          domain: 'brand.com',
        }).success,
      ).toBe(false);
    });
  });

  describe('FIND_AGENCY_EMAILS output', () => {
    it('accepts RESULTS_FOUND with sourceKind agency_web + provenance (never VERIFIED)', () => {
      const parsed = contactResearchOutputSchema.safeParse({
        operation: 'FIND_AGENCY_EMAILS',
        outcome: 'RESULTS_FOUND',
        emails: [
          {
            email: 'partnerships@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/contact',
            evidenceSnippet: 'Email partnerships@creatorpartners.example',
            sourceKind: 'agency_web',
            isGeneric: true,
            commercialRelevance: 'HIGH',
            outreachRole: 'Partnerships',
            provenance: {
              discoveryStatus: 'FOUND',
              attributionStatus: 'ATTRIBUTED',
              verificationStatus: 'UNVERIFIED',
            },
          },
        ],
        pageSnapshots: [snap],
        trace: {
          queries: ['site:creatorpartners.example partnerships'],
          pages: [snap.url],
          serpCalls: 1,
          pageCalls: 1,
        },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.operation === 'FIND_AGENCY_EMAILS') {
        expect(parsed.data.emails[0]?.sourceKind).toBe('agency_web');
      }
    });

    it('defaults sourceKind to agency_web when omitted (Nest must still persist it)', () => {
      const parsed = agencyContactFoundEmailSchema.safeParse({
        email: 'info@creatorpartners.example',
        sourceUrl: 'https://creatorpartners.example/contact',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sourceKind).toBe('agency_web');
      }
    });

    it('rejects linkedin/ocr/brand_web as mailbox sourceKind', () => {
      for (const sourceKind of ['linkedin', 'ocr', 'brand_web'] as const) {
        expect(
          agencyContactFoundEmailSchema.safeParse({
            email: 'a@creatorpartners.example',
            sourceUrl: 'https://creatorpartners.example/c',
            sourceKind,
          }).success,
        ).toBe(false);
      }
    });

    it('accepts NO_MATCHES and PROVIDER_FAILURE distinctly', () => {
      expect(
        contactResearchOutputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          outcome: 'NO_MATCHES',
          emails: [],
        }).success,
      ).toBe(true);
      expect(
        contactResearchOutputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          outcome: 'PROVIDER_FAILURE',
          emails: [],
          summary: 'SERP transport failed',
        }).success,
      ).toBe(true);
    });

    it('rejects invalid outcome', () => {
      expect(
        contactResearchOutputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          outcome: 'SUCCESS',
          emails: [],
        }).success,
      ).toBe(false);
    });

    it('rejects VERIFIED provenance (no fake SMTP)', () => {
      expect(
        agencyContactEmailProvenanceSchema.safeParse({
          discoveryStatus: 'FOUND',
          attributionStatus: 'ATTRIBUTED',
          verificationStatus: 'VERIFIED',
        }).success,
      ).toBe(false);
      expect(
        agencyContactFoundEmailSchema.safeParse({
          email: 'a@creatorpartners.example',
          sourceUrl: 'https://creatorpartners.example/c',
          provenance: { verificationStatus: 'VERIFIED' },
        }).success,
      ).toBe(false);
    });

    it('caps pageSnapshots at 4', () => {
      const many = [snap, snap, snap, snap, snap];
      expect(
        contactResearchOutputSchema.safeParse({
          operation: 'FIND_AGENCY_EMAILS',
          outcome: 'NO_MATCHES',
          emails: [],
          pageSnapshots: many,
        }).success,
      ).toBe(false);
    });
  });

  describe('FIND_AGENCY_PEOPLE (contract prep; people-pass ALWAYS)', () => {
    it('accepts people input without pageSnapshots (emails empty / failed)', () => {
      const parsed = contactResearchFindAgencyPeopleInputSchema.safeParse({
        operation: 'FIND_AGENCY_PEOPLE',
        ...agencyBase,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.peoplePassPolicy).toBe('ALWAYS');
        expect(parsed.data.maxAgencyPages).toBe(6);
      }
    });

    it('accepts people input with snapshots AND after HIGH emails (ALWAYS)', () => {
      const parsed = contactResearchInputSchema.safeParse({
        operation: 'FIND_AGENCY_PEOPLE',
        ...agencyBase,
        niches: ['beauty'],
        markets: ['Spain'],
        priorityRoles: [...AGENCY_CONTACT_DEFAULT_PRIORITY_ROLES],
        peoplePassPolicy: 'ALWAYS',
        pageSnapshots: [snap],
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects non-ALWAYS peoplePassPolicy', () => {
      expect(
        contactResearchFindAgencyPeopleInputSchema.safeParse({
          operation: 'FIND_AGENCY_PEOPLE',
          ...agencyBase,
          peoplePassPolicy: 'IF_NO_HIGH_MEDIUM',
        }).success,
      ).toBe(false);
    });

    it('accepts people output with agency_web sourceKind + peeReuse', () => {
      const parsed = contactResearchOutputSchema.safeParse({
        operation: 'FIND_AGENCY_PEOPLE',
        outcome: 'RESULTS_FOUND',
        people: [
          {
            name: 'Alex Partner',
            title: 'Head of Influencer Partnerships',
            linkedinUrl: 'https://www.linkedin.com/in/alex-partner',
            emails: [
              {
                email: 'alex@creatorpartners.example',
                sourceUrl: 'https://creatorpartners.example/team',
                sourceKind: 'agency_web',
                evidenceSnippet: 'Alex Partner alex@creatorpartners.example',
                provenance: { verificationStatus: 'UNVERIFIED' },
              },
            ],
          },
        ],
        trace: {
          queries: ['site:linkedin.com/in "Creator Partners"'],
          linkedinUrlsConsidered: [
            'https://www.linkedin.com/in/alex-partner',
          ],
          profilesScraped: 1,
          serpCalls: 1,
          agencyPagesFetched: 2,
          peeReuse: {
            snapshotsReceivedFromEmailsPass: 1,
            peePagesReused: 1,
            peePagesFetchedUnlocker: 0,
            peePagesRejected: 0,
            unlockerCallsAvoided: 1,
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects brand_web on agency person emails (use agency_web)', () => {
      expect(
        contactResearchOutputSchema.safeParse({
          operation: 'FIND_AGENCY_PEOPLE',
          outcome: 'RESULTS_FOUND',
          people: [
            {
              name: 'Alex',
              linkedinUrl: 'https://www.linkedin.com/in/alex',
              emails: [
                {
                  email: 'alex@creatorpartners.example',
                  sourceUrl: 'https://creatorpartners.example/team',
                  sourceKind: 'brand_web',
                },
              ],
            },
          ],
        }).success,
      ).toBe(false);
    });
  });

  describe('separation from brand contracts', () => {
    it('FIND_BRAND_EMAILS mailboxes stay without sourceKind (2A unchanged)', () => {
      const parsed = contactResearchOutputSchema.safeParse({
        operation: 'FIND_BRAND_EMAILS',
        outcome: 'RESULTS_FOUND',
        emails: [
          {
            email: 'hello@brand.com',
            sourceUrl: 'https://brand.com/contact',
          },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.operation === 'FIND_BRAND_EMAILS') {
        expect(parsed.data.emails[0]).not.toHaveProperty('sourceKind');
      }
    });

    it('still accepts FIND_BRAND_EMAILS / FIND_BRAND_PEOPLE unchanged', () => {
      expect(
        contactResearchInputSchema.safeParse({
          operation: 'FIND_BRAND_EMAILS',
          brandName: 'Brand',
          website: 'https://brand.com',
          domain: 'brand.com',
        }).success,
      ).toBe(true);
      expect(
        contactResearchInputSchema.safeParse({
          operation: 'FIND_BRAND_PEOPLE',
          brandName: 'Brand',
          website: 'https://brand.com',
          domain: 'brand.com',
        }).success,
      ).toBe(true);
      expect(
        contactResearchOutputSchema.safeParse({
          operation: 'FIND_BRAND_EMAILS',
          outcome: 'NO_MATCHES',
          emails: [],
        }).success,
      ).toBe(true);
    });

    it('does not accept agencyId on FIND_BRAND_EMAILS as the subject key', () => {
      const parsed = contactResearchInputSchema.safeParse({
        operation: 'FIND_BRAND_EMAILS',
        agencyId: 'agency-1',
        brandName: 'Brand',
        website: 'https://brand.com',
        domain: 'brand.com',
      });
      // Zod object strips unknown keys by default in Zod 4? or passes — brand op still valid
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.operation === 'FIND_BRAND_EMAILS') {
        expect(parsed.data).not.toHaveProperty('agencyId');
      }
    });
  });

  describe('CONTACT_RESEARCH envelope compatibility', () => {
    it('wraps FIND_AGENCY_EMAILS in AiExecutionRequest', () => {
      const parsed = aiExecutionRequestSchema.safeParse({
        contractVersion: '1.0',
        type: 'CONTACT_RESEARCH',
        executionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        idempotencyKey: 'agency-emails:run-1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        requestedAt: '2026-11-17T12:00:00.000Z',
        context: {
          userId: 'user-1',
          resourceType: 'CONTACT_RESEARCH_RUN',
          resourceId: 'agency-contact-run-1',
        },
        instructions: { business: 'Find agency commercial emails' },
        input: {
          operation: 'FIND_AGENCY_EMAILS',
          ...agencyBase,
        },
      });
      expect(parsed.success).toBe(true);
    });

    it('wraps FIND_AGENCY_EMAILS result in AiExecutionResult', () => {
      const parsed = aiExecutionResultSchema.safeParse({
        contractVersion: '1.0',
        type: 'CONTACT_RESEARCH',
        executionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'COMPLETED',
        startedAt: '2026-11-17T12:00:00.000Z',
        finishedAt: '2026-11-17T12:00:02.000Z',
        durationMs: 1200,
        metadata: {},
        output: {
          operation: 'FIND_AGENCY_EMAILS',
          outcome: 'NO_MATCHES',
          emails: [],
        },
      });
      expect(parsed.success).toBe(true);
    });
  });
});

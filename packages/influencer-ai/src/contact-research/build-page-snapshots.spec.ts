import { ContactResearchToolSession } from '../brightdata/session';
import { normalizeUrlKey } from '../brightdata/normalize-url-key';
import {
  CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX,
  CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_CHARS,
  CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_TOTAL_BYTES,
  buildContactResearchPageSnapshots,
  extractMailtoEmailsFromHtml,
} from './build-page-snapshots';

describe('buildContactResearchPageSnapshots (RF-04.3)', () => {
  function sessionWithPages(
    pages: Array<{ url: string; html: string; fetchedAt?: string }>,
  ) {
    const session = new ContactResearchToolSession({
      brandName: 'Acme',
      website: 'https://acme.test',
      domain: 'acme.test',
      maxSerpQueries: 2,
      maxPages: 8,
    });
    for (const p of pages) {
      session.pages.push(p.url);
      session.setPageHtml(p.url, p.html, p.fetchedAt);
    }
    return session;
  }

  it('emits successful pages with real fetchedAt and normalizedUrl', () => {
    const fetchedAt = '2026-03-01T12:00:00.000Z';
    const session = sessionWithPages([
      {
        url: 'https://Acme.test/Contact/',
        html: '<a href="mailto:hello@acme.test">x</a>',
        fetchedAt,
      },
    ]);

    const snaps = buildContactResearchPageSnapshots(session);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].fetchedAt).toBe(fetchedAt);
    expect(snaps[0].normalizedUrl).toBe(
      normalizeUrlKey('https://Acme.test/Contact/'),
    );
    expect(snaps[0].url).toBe('https://Acme.test/Contact/');
    expect(snaps[0].mailtoEmails).toEqual(['hello@acme.test']);
    expect(snaps[0].truncated).toBe(false);
  });

  it('skips empty HTML and caps at max pages', () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({
      url: `https://acme.test/p${i}`,
      html: i === 1 ? '' : `<html>page ${i}</html>`,
    }));
    const session = sessionWithPages(pages);
    const snaps = buildContactResearchPageSnapshots(session);
    expect(snaps.length).toBe(CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX);
    expect(snaps.every((s) => s.content.length > 0)).toBe(true);
  });

  it('truncates long content and preserves mailtoEmails', () => {
    const big = 'x'.repeat(CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_CHARS + 500);
    const html = `<a href="mailto:press@acme.test">p</a>${big}`;
    const session = sessionWithPages([
      { url: 'https://acme.test/contact', html },
    ]);
    const snaps = buildContactResearchPageSnapshots(session);
    expect(snaps[0].truncated).toBe(true);
    expect(snaps[0].content.length).toBe(
      CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_CHARS,
    );
    expect(snaps[0].mailtoEmails).toEqual(['press@acme.test']);
  });

  it('stops when total byte budget is exhausted (deterministic)', () => {
    const chunk = 'y'.repeat(20_000);
    const session = sessionWithPages([
      { url: 'https://acme.test/a', html: chunk },
      { url: 'https://acme.test/b', html: chunk },
      { url: 'https://acme.test/c', html: chunk },
      { url: 'https://acme.test/d', html: chunk },
    ]);
    const snaps = buildContactResearchPageSnapshots(session, {
      maxTotalBytes: CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_TOTAL_BYTES,
    });
    const total = snaps.reduce(
      (n, s) => n + Buffer.byteLength(s.content, 'utf8'),
      0,
    );
    expect(total).toBeLessThanOrEqual(
      CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_TOTAL_BYTES,
    );
    expect(snaps.length).toBeLessThanOrEqual(4);
    expect(snaps.length).toBeGreaterThanOrEqual(3);
  });

  it('extractMailtoEmailsFromHtml dedupes and ignores junk', () => {
    expect(
      extractMailtoEmailsFromHtml(
        '<a href="mailto:A@Acme.Test">a</a><a href="mailto:a@acme.test?subject=x">b</a><a href="mailto:not-an-email">c</a>',
      ),
    ).toEqual(['a@acme.test']);
  });
});

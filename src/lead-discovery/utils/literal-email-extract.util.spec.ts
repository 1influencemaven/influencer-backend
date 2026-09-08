import {
  emailLiteralInEvidence,
  extractLiteralEmailsFromText,
  isMaskedOrIncompleteEmail,
} from './literal-email-extract.util';

describe('literal-email-extract.util', () => {
  it('extracts literal emails from HTML', () => {
    const html =
      '<p>Reach us at partnerships@liquid-iv.com for inquiries.</p>';
    const matches = extractLiteralEmailsFromText(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].email).toBe('partnerships@liquid-iv.com');
    expect(matches[0].evidenceSnippet).toContain('partnerships@liquid-iv.com');
  });

  it('rejects masked emails', () => {
    const html = 'Contact m*****@company.com or john.s...@company.com';
    expect(extractLiteralEmailsFromText(html)).toHaveLength(0);
    expect(isMaskedOrIncompleteEmail('m*****@company.com')).toBe(true);
    expect(isMaskedOrIncompleteEmail('[hidden]@company.com')).toBe(true);
  });

  it('normalizes emails to lowercase', () => {
    const html = 'Email INFO@COMPANY.COM today';
    const matches = extractLiteralEmailsFromText(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].email).toBe('info@company.com');
  });

  it('deduplicates the same email on one page', () => {
    const html =
      'info@company.com and again info@company.com and INFO@COMPANY.COM';
    const matches = extractLiteralEmailsFromText(html);
    expect(matches).toHaveLength(1);
  });

  it('extracts multiple distinct emails from one page', () => {
    const html =
      'sales@company.com for sales, marketing@company.com for marketing';
    const matches = extractLiteralEmailsFromText(html);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.email).sort()).toEqual([
      'marketing@company.com',
      'sales@company.com',
    ]);
  });

  it('returns empty for empty page content', () => {
    expect(extractLiteralEmailsFromText('')).toHaveLength(0);
    expect(extractLiteralEmailsFromText('   ')).toHaveLength(0);
  });

  it('enforces email literal in evidence snippet', () => {
    const match = extractLiteralEmailsFromText(
      'hello john.smith@company.com world',
    )[0];
    expect(emailLiteralInEvidence(match.email, match.evidenceSnippet)).toBe(
      true,
    );
    expect(
      emailLiteralInEvidence('fake@company.com', match.evidenceSnippet),
    ).toBe(false);
  });

  it('rejects CSS and package-version false positives', () => {
    const html = 'font-weight: wght@400; swiper@11.0.0';
    expect(extractLiteralEmailsFromText(html)).toHaveLength(0);
  });

  it('extracts email after unicode escape artifacts', () => {
    const html = 'u003einfo@liquid-iv.com';
    const matches = extractLiteralEmailsFromText(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].email).toBe('info@liquid-iv.com');
  });
});

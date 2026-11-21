import {
  evidenceSnippetAroundEmail,
  extractEmailsFromHtml,
} from './extract-emails';

describe('extractEmailsFromHtml', () => {
  it('finds literal emails and drops asset false positives', () => {
    const html = `
      <html><body>
        Contact <a href="mailto:partnerships@brand.com">us</a>
        or press@brand.com for media.
        <link href="https://cdn.example/ecom-swiper@11.css" />
        <script src="foo@2.js"></script>
        noreply@brand.com
      </body></html>`;
    expect(extractEmailsFromHtml(html)).toEqual([
      'partnerships@brand.com',
      'press@brand.com',
    ]);
  });

  it('builds a short evidence snippet', () => {
    const html = '<p>Write to partnerships@brand.com for collabs today.</p>';
    const snip = evidenceSnippetAroundEmail(html, 'partnerships@brand.com');
    expect(snip.toLowerCase()).toContain('partnerships@brand.com');
  });
});

import { extractCommercialLinks } from './commercial-links';

describe('extractCommercialLinks', () => {
  const page = 'https://www.gorjana.com/';

  it('ranks same-site collab/affiliate links above press and contact; skips shop links', () => {
    const html = [
      '<a href="/pages/contact-us">Contact</a>',
      '<a href="/pages/press">Press</a>',
      '<a href="/pages/gorjana-ambassadors">Join our ambassador program</a>',
      '<a href="/collections/necklaces">Necklaces</a>',
      '<a href="/products/parker-necklace">Parker</a>',
      '<a href="https://instagram.com/gorjana">Instagram</a>',
      '<a href="mailto:care@gorjana.com">Email</a>',
      '<a href="/pages/collaborate?ref=footer#top">Collaborate</a>',
    ].join('');
    expect(extractCommercialLinks(html, page)).toEqual([
      'https://www.gorjana.com/pages/gorjana-ambassadors',
      'https://www.gorjana.com/pages/collaborate',
      'https://www.gorjana.com/pages/press',
      'https://www.gorjana.com/pages/contact-us',
    ]);
  });

  it('uses the anchor text when the slug is opaque', () => {
    expect(
      extractCommercialLinks(
        '<a href="/pages/x12">Influencer program</a>',
        page,
      ),
    ).toEqual(['https://www.gorjana.com/pages/x12']);
  });
});

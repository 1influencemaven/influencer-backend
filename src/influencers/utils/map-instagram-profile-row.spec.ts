import { INFLUENCER_FIELD_KEYS } from './influencer-field-keys';
import { mapInstagramProfileRow } from './map-instagram-profile-row';

describe('mapInstagramProfileRow', () => {
  it('maps available Influencer fields only', () => {
    const mapped = mapInstagramProfileRow({
      account: 'LauraFit_ES',
      profile_name: 'Laura Fit',
      full_name: 'Laura Martínez',
      followers: 180_000,
      email_address: 'Laura@Example.com',
      biography: 'Fitness coach',
      is_private: false,
      profile_url: 'https://www.instagram.com/laurafit_es/',
    });

    expect(mapped.outcome).toBe('ok');
    expect(mapped.accountNormalized).toBe('laurafit_es');
    expect(mapped.candidates).toEqual(
      expect.arrayContaining([
        { fieldKey: INFLUENCER_FIELD_KEYS.NAME, value: 'Laura Fit' },
        { fieldKey: INFLUENCER_FIELD_KEYS.FOLLOWERS, value: 180_000 },
        {
          fieldKey: INFLUENCER_FIELD_KEYS.EMAIL,
          value: 'laura@example.com',
        },
      ]),
    );
    expect(
      mapped.candidates.some((c) => c.fieldKey === INFLUENCER_FIELD_KEYS.NICHES),
    ).toBe(false);
    expect(
      mapped.candidates.some(
        (c) => c.fieldKey === INFLUENCER_FIELD_KEYS.ENGAGEMENT,
      ),
    ).toBe(false);
  });

  it('marks private profiles without candidates', () => {
    const mapped = mapInstagramProfileRow({
      account: 'secret',
      followers: 10,
      is_private: true,
    });

    expect(mapped.outcome).toBe('private');
    expect(mapped.candidates).toEqual([]);
  });

  it('detects not found warnings', () => {
    const mapped = mapInstagramProfileRow({
      warning: 'Page not found',
      warning_code: 'dead_page',
    });

    expect(mapped.outcome).toBe('not_found');
  });

  it('returns incomplete when no mappable fields', () => {
    const mapped = mapInstagramProfileRow({
      account: 'emptybio',
      is_private: false,
      id: '123',
    });

    expect(mapped.outcome).toBe('incomplete');
    expect(mapped.candidates).toEqual([]);
  });
});

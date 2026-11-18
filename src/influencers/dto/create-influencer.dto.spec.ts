import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateInfluencerDto } from './create-influencer.dto';

const VALID_MANAGER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('CreateInfluencerDto', () => {
  it('should pass validation with valid data', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
      language: 'es',
      niches: ['Fitness', 'Lifestyle'],
      followers: 180000,
      engagement: 4.5,
      email: 'laura@example.com',
      outgoingEmail: 'out@agency.com',
      mediaKitUrl: 'https://example.com/mediakit',
      quarters: [
        { year: 2026, quarter: 'Q1' },
        { year: 2025, quarter: 'Q4' },
      ],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should accept optional Instagram research evidence on create', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'PIXEL SPARTAN',
      instagram: '@pixel.vnzla',
      managerId: VALID_MANAGER_ID,
      country: 'VE',
      instagramResearch: {
        source: 'brightdata:instagram:gd_x',
        fetchedAt: '2026-11-13T20:00:00.000Z',
        handleNormalized: 'pixel.vnzla',
        profileUrl: 'https://www.instagram.com/pixel.vnzla/',
        normalized: {
          account: 'pixel.vnzla',
          displayName: 'PIXEL SPARTAN',
          biography: 'Bio',
          followers: 10232,
          following: 2244,
          postsCount: 583,
          isPrivate: false,
          isVerified: false,
          emailAddress: null,
          bioHashtags: ['venezuela'],
          postHashtags: ['dancehall'],
        },
      },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when managerId is a valid UUID', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should fail when managerId is absent', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'managerId')).toBe(true);
  });

  it('should fail when managerId is undefined', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: undefined,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'managerId')).toBe(true);
  });

  it('should fail when managerId is null', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: null,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'managerId')).toBe(true);
  });

  it('should fail when managerId is an empty string', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: '',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'managerId')).toBe(true);
  });

  it('should fail when managerId is an invalid UUID', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: 'not-a-uuid',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'managerId')).toBe(true);
  });

  it('should fail when name is missing', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('should fail when instagram is missing', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'instagram')).toBe(true);
  });

  it('should fail when country code is invalid', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ESP',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'country')).toBe(true);
  });

  it('should fail when country is missing (P1c)', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'country')).toBe(true);
  });

  it('should fail when country is not ISO alpha-2 (P1c)', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ZZ',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'country')).toBe(true);
  });

  it('should fail when engagement is out of range', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
      engagement: 150,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'engagement')).toBe(true);
  });

  it('should fail when followers is negative', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
      followers: -1,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'followers')).toBe(true);
  });

  it('should fail when quarters contain duplicate year+quarter', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      instagram: '@laurafit_es',
      managerId: VALID_MANAGER_ID,
      country: 'ES',
      quarters: [
        { year: 2026, quarter: 'Q1' },
        { year: 2026, quarter: 'Q1' },
      ],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'quarters')).toBe(true);
  });
});

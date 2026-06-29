import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateInfluencerDto } from './create-influencer.dto';

describe('CreateInfluencerDto', () => {
  it('should pass validation with valid data', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      country: 'ES',
      language: 'es',
      followers: 180000,
      engagement: 4.5,
      email: 'laura@example.com',
      mediaKitUrl: 'https://example.com/mediakit',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should fail when name is missing', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      country: 'ES',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('should fail when country code is invalid', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      country: 'ESP',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'country')).toBe(true);
  });

  it('should fail when engagement is out of range', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      engagement: 150,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'engagement')).toBe(true);
  });

  it('should fail when followers is negative', async () => {
    const dto = plainToInstance(CreateInfluencerDto, {
      name: 'Laura Martínez',
      followers: -1,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'followers')).toBe(true);
  });
});

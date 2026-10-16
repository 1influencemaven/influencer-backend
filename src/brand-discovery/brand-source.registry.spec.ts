import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrandSourceRegistry } from './brand-source.registry';
import type { BrandSourceProvider } from './interfaces/brand-source-provider.interface';

describe('BrandSourceRegistry', () => {
  const createProvider = (name: string): BrandSourceProvider => ({
    name,
    discover: jest.fn(),
  });

  function createRegistry(withBrightData: boolean) {
    const configService = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const providers = new Map();
    if (withBrightData) {
      providers.set('brightdata', createProvider('ai+brightdata'));
    }

    return new BrandSourceRegistry(providers, configService);
  }

  it('lists only brightdata when configured', () => {
    const registry = createRegistry(true);
    expect(registry.listAvailable()).toEqual(['brightdata']);
    expect(registry.getDefault()).toBe('brightdata');
  });

  it('always resolves brightdata even if another source is requested', () => {
    const registry = createRegistry(true);
    expect(registry.resolve('tavily').id).toBe('brightdata');
    expect(registry.resolve().id).toBe('brightdata');
  });

  it('throws when Bright Data is not configured', () => {
    const registry = createRegistry(false);
    expect(() => registry.resolve()).toThrow(BadRequestException);
    expect(() => registry.resolve()).toThrow(/BRIGHTDATA_API_KEY/);
  });
});

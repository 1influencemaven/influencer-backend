import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrandSourceRegistry } from './brand-source.registry';
import type { BrandSourceProvider } from './interfaces/brand-source-provider.interface';

describe('BrandSourceRegistry', () => {
  const createProvider = (name: string): BrandSourceProvider => ({
    name,
    discover: jest.fn(),
  });

  function createRegistry(withTavily: boolean) {
    const configService = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const providers = new Map();
    if (withTavily) {
      providers.set('tavily', createProvider('ai+tavily'));
    }

    return new BrandSourceRegistry(providers, configService);
  }

  it('lists only tavily when configured', () => {
    const registry = createRegistry(true);
    expect(registry.listAvailable()).toEqual(['tavily']);
    expect(registry.getDefault()).toBe('tavily');
  });

  it('always resolves tavily even if another source is requested', () => {
    const registry = createRegistry(true);
    expect(registry.resolve('brightdata').id).toBe('tavily');
    expect(registry.resolve().id).toBe('tavily');
  });

  it('throws when tavily is not configured', () => {
    const registry = createRegistry(false);
    expect(() => registry.resolve()).toThrow(BadRequestException);
  });
});

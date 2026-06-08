import { ExecutionContext } from '@nestjs/common';

const mockCanActivate = jest.fn();

jest.mock('@nestjs/passport', () => ({
  AuthGuard: jest.fn(() => {
    return class MockAuthGuard {
      canActivate(context: ExecutionContext) {
        return mockCanActivate(context);
      }
    };
  }),
}));

import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  beforeEach(() => {
    mockCanActivate.mockClear();
  });

  it('should extend AuthGuard with jwt strategy', () => {
    expect(AuthGuard).toHaveBeenCalledWith('jwt');
  });

  it('should be defined and instantiable', () => {
    const guard = new JwtAuthGuard();

    expect(guard).toBeDefined();
    expect(guard.canActivate).toBeDefined();
  });

  it('should delegate canActivate to AuthGuard', () => {
    const guard = new JwtAuthGuard();
    const context = {} as ExecutionContext;

    mockCanActivate.mockReturnValue(true);

    const result = guard.canActivate(context);

    expect(mockCanActivate).toHaveBeenCalledWith(context);
    expect(result).toBe(true);
  });
});

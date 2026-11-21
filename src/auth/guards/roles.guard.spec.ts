import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const createContext = (user?: { role: string }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    rolesGuard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(rolesGuard.canActivate(createContext({ role: 'USER' }))).toBe(true);
  });

  it('should allow access when the user has a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(rolesGuard.canActivate(createContext({ role: 'ADMIN' }))).toBe(true);
  });

  it('should deny access when the user lacks the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(() =>
      rolesGuard.canActivate(createContext({ role: 'USER' })),
    ).toThrow(ForbiddenException);
  });

  it('should deny access when there is no authenticated user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(() => rolesGuard.canActivate(createContext())).toThrow(
      ForbiddenException,
    );
  });

  it('should read roles metadata from handler and class', () => {
    const getAllAndOverrideSpy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.ADMIN]);

    rolesGuard.canActivate(createContext({ role: 'ADMIN' }));

    expect(getAllAndOverrideSpy).toHaveBeenCalledWith(
      ROLES_KEY,
      expect.any(Array),
    );
  });
});

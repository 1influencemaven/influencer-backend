import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('./users.service', () => ({
  UsersService: class UsersService {},
}));

jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

jest.mock('../auth/guards/roles.guard', () => ({
  RolesGuard: class RolesGuard {},
}));

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let usersController: UsersController;

  const usersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const adminUser: AuthUser = {
    id: 'admin-id',
    email: 'admin@example.com',
    role: 'ADMIN',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    usersController = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should delegate findAll to the service', async () => {
    usersService.findAll.mockResolvedValue([]);

    await expect(usersController.findAll()).resolves.toEqual([]);
    expect(usersService.findAll).toHaveBeenCalled();
  });

  it('should delegate findOne to the service', async () => {
    usersService.findOne.mockResolvedValue({ id: 'user-id' });

    await expect(usersController.findOne('user-id')).resolves.toEqual({
      id: 'user-id',
    });
  });

  it('should delegate create to the service', async () => {
    const dto = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'password123',
    };

    usersService.create.mockResolvedValue({ id: 'user-id', ...dto });

    await expect(usersController.create(dto)).resolves.toEqual({
      id: 'user-id',
      ...dto,
    });
  });

  it('should delegate update to the service', async () => {
    const dto = { name: 'Updated Name' };
    usersService.update.mockResolvedValue({
      id: 'user-id',
      name: 'Updated Name',
    });

    await expect(usersController.update('user-id', dto)).resolves.toEqual({
      id: 'user-id',
      name: 'Updated Name',
    });
  });

  it('should delegate remove to the service with the current user id', async () => {
    usersService.remove.mockResolvedValue({
      message: 'User deleted successfully',
    });

    await expect(usersController.remove('user-id', adminUser)).resolves.toEqual(
      {
        message: 'User deleted successfully',
      },
    );

    expect(usersService.remove).toHaveBeenCalledWith('user-id', 'admin-id');
  });

  it('should propagate service exceptions', async () => {
    usersService.findOne.mockRejectedValue(
      new NotFoundException('User not found'),
    );

    await expect(usersController.findOne('missing-id')).rejects.toThrow(
      NotFoundException,
    );

    usersService.create.mockRejectedValue(
      new ConflictException('Email already exists'),
    );

    await expect(
      usersController.create({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

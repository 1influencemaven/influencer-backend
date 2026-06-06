import {
  // BadRequestException,
  Controller,
  Get,
  // Req,
  // Version,
} from '@nestjs/common';
import { AppService } from './app.service';
// import type { Request } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // @Get('test-cookie')
  // testCookie(@Req() req: Request) {
  //   return req.cookies;
  // }

  // /api/v1/test-version
  // @Version('1')
  // @Get('test-version')
  // findAll() {
  //   return [];
  // }

  // @Get('test-error')
  // test() {
  //   throw new BadRequestException('Email already exists');
  // }
}

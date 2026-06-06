import { Controller, Get, Req } from '@nestjs/common';
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
}

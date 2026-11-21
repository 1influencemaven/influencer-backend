import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

import { UNLOCKER_DIAGNOSTIC_ALLOWED_URL } from '../utils/unlocker-diagnostics.constants';

export class UnlockerDiagnosticRequestDto {
  @ApiProperty({
    description:
      'Exact allowlisted URL for the Unlocker diagnostic probe (no other URLs).',
    example: UNLOCKER_DIAGNOSTIC_ALLOWED_URL,
    enum: [UNLOCKER_DIAGNOSTIC_ALLOWED_URL],
  })
  @IsString()
  @IsIn([UNLOCKER_DIAGNOSTIC_ALLOWED_URL], {
    message: `url must be exactly ${UNLOCKER_DIAGNOSTIC_ALLOWED_URL}`,
  })
  url!: typeof UNLOCKER_DIAGNOSTIC_ALLOWED_URL;
}

export class UnlockerDiagnosticResponseDto {
  @ApiProperty({ example: UNLOCKER_DIAGNOSTIC_ALLOWED_URL })
  url!: string;

  @ApiProperty({
    description: 'Typed Unlocker outcome',
    example: 'ok',
  })
  outcome!: string;

  @ApiProperty({
    description:
      'HTTP status of api.brightdata.com/request — not the target site',
    example: 200,
  })
  apiHttpStatus!: number;

  @ApiProperty({ example: 48210 })
  bodyLength!: number;

  @ApiProperty({ example: 1840 })
  elapsedMs!: number;

  @ApiProperty({
    description: 'Unlocker zone name (never credentials)',
    example: 'mcp_unlocker',
  })
  zone!: string;

  @ApiProperty({ required: false })
  errorName?: string;

  @ApiProperty({
    required: false,
    description: 'Sanitized error message — never credentials or HTML body',
  })
  errorMessage?: string;

  @ApiProperty({
    required: false,
    description: 'Sanitized `error.cause.name` of the transport failure',
    example: 'Error',
  })
  causeName?: string;

  @ApiProperty({
    required: false,
    description: 'Sanitized `error.cause.code` (syscall error code)',
    example: 'ENOTFOUND',
  })
  causeCode?: string;

  @ApiProperty({
    required: false,
    description: 'Sanitized `error.cause.syscall`',
    example: 'getaddrinfo',
  })
  causeSyscall?: string;

  @ApiProperty({
    required: false,
    description:
      'Sanitized `error.cause.hostname` of the outbound connection (Bright Data API host/proxy, not the target site)',
    example: 'api.brightdata.com',
  })
  causeHostname?: string;

  @ApiProperty({
    required: false,
    description: 'Outbound connection port from `error.cause.port` (0–65535)',
    example: 443,
  })
  causePort?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Providers accepted by both Saleshandy connect endpoints (bulk and single). */
export const EMAIL_PROVIDERS = [
  'gsuite',
  'microsoft',
  'o365',
  'yahoo',
  'zoho',
  'godaddy',
  'yandex',
  'sendgrid',
  'other',
] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export const MAIL_ENCRYPTIONS = ['ssl', 'tls', 'none'] as const;
export type MailEncryption = (typeof MAIL_ENCRYPTIONS)[number];

/** Max accounts per bulk connect request (keeps payloads and CSV reports reasonable). */
export const BULK_CONNECT_MAX_ACCOUNTS = 50;

export class MailServerSettingsDto {
  @ApiProperty({ example: 'ana@brand-mail.com' })
  @IsEmail()
  @MaxLength(254)
  emailAddress!: string;

  @ApiProperty({ example: 'ana@brand-mail.com' })
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  userName!: string;

  @ApiProperty({ description: 'Never stored or logged.', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;

  @ApiProperty({ example: 'smtp.zoho.com' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  host!: string;

  @ApiProperty({ example: 465 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @ApiProperty({ enum: MAIL_ENCRYPTIONS, example: 'ssl' })
  @IsIn(MAIL_ENCRYPTIONS)
  encryption!: MailEncryption;
}

/** One sender mailbox (shared shape for single connect, bulk connect and CSV import). */
export class EmailAccountConnectionDto {
  @ApiProperty({ enum: EMAIL_PROVIDERS, example: 'zoho' })
  @IsIn(EMAIL_PROVIDERS)
  provider!: EmailProvider;

  @ApiProperty({ example: 'Ana' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fromFirstName!: string;

  @ApiProperty({ example: 'Pérez' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fromLastName!: string;

  @ApiPropertyOptional({
    description: 'Display name in the From header. Defaults to "first last".',
    example: 'Ana Pérez',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fromName?: string;

  @ApiProperty({ type: MailServerSettingsDto })
  @ValidateNested()
  @Type(() => MailServerSettingsDto)
  smtp!: MailServerSettingsDto;

  @ApiProperty({ type: MailServerSettingsDto })
  @ValidateNested()
  @Type(() => MailServerSettingsDto)
  imap!: MailServerSettingsDto;
}

export class BulkConnectEmailAccountsDto {
  @ApiProperty({ type: [EmailAccountConnectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_CONNECT_MAX_ACCOUNTS)
  @ValidateNested({ each: true })
  @Type(() => EmailAccountConnectionDto)
  accounts!: EmailAccountConnectionDto[];
}

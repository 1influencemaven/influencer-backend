import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BrightDataSearchClient,
  sanitizeUnlockerErrorMessage,
} from '../integrations/brightdata';
import type { UnlockerDiagnosticResponseDto } from './dto/unlocker-diagnostic.dto';
import { UNLOCKER_DIAGNOSTIC_ALLOWED_URL } from './utils/unlocker-diagnostics.constants';

@Injectable()
export class UnlockerDiagnosticsService {
  constructor(
    private readonly unlocker: BrightDataSearchClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Single-shot Unlocker probe. No retries, no DB writes, no discovery tracks.
   * Response never includes HTML or credentials.
   */
  async probe(url: string): Promise<UnlockerDiagnosticResponseDto> {
    this.assertDiagnosticsAvailable();
    this.assertAllowedUrl(url);

    if (!this.unlocker.isConfigured()) {
      throw new ServiceUnavailableException(
        'Bright Data Unlocker is not configured (missing API key)',
      );
    }

    const fetched = await this.unlocker.fetchRawHtml(url);

    const response: UnlockerDiagnosticResponseDto = {
      url,
      outcome: fetched.outcome,
      apiHttpStatus: fetched.httpStatus,
      bodyLength: fetched.bodyLength,
      elapsedMs: fetched.elapsedMs,
      zone: fetched.zone,
    };

    if (fetched.errorName) {
      response.errorName = fetched.errorName;
    }
    if (fetched.errorMessage) {
      response.errorMessage = sanitizeUnlockerErrorMessage(
        fetched.errorMessage,
      );
    }
    if (fetched.causeName) response.causeName = fetched.causeName;
    if (fetched.causeCode) response.causeCode = fetched.causeCode;
    if (fetched.causeSyscall) response.causeSyscall = fetched.causeSyscall;
    if (fetched.causeHostname) response.causeHostname = fetched.causeHostname;
    if (fetched.causePort !== undefined) response.causePort = fetched.causePort;

    return response;
  }

  private assertDiagnosticsAvailable(): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'production') {
      throw new ForbiddenException(
        'Unlocker diagnostics are disabled in production',
      );
    }

    const flag = this.configService.get<boolean | string>(
      'UNLOCKER_DIAGNOSTICS_ENABLED',
    );
    const enabled = flag === true || flag === 'true';
    if (!enabled) {
      throw new ForbiddenException(
        'Unlocker diagnostics require UNLOCKER_DIAGNOSTICS_ENABLED=true',
      );
    }
  }

  private assertAllowedUrl(url: string): void {
    if (url !== UNLOCKER_DIAGNOSTIC_ALLOWED_URL) {
      throw new BadRequestException(
        `url must be exactly ${UNLOCKER_DIAGNOSTIC_ALLOWED_URL}`,
      );
    }
  }
}

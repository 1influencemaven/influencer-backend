import { ConfigService } from '@nestjs/config';

/** Stable API / job error code while Lead Discovery write path is disabled. */
export const CONTACT_DISCOVERY_REBUILD_CODE =
  'CONTACT_DISCOVERY_REBUILD' as const;

export const CONTACT_DISCOVERY_REBUILD_MESSAGE =
  'Lead Discovery write path is disabled (CONTACT_DISCOVERY_REBUILD_MODE). Historical reads remain available. Rebuild in progress — do not enable in production without explicit approval.';

/**
 * Local-only gate for disabling the legacy Lead Discovery write pipeline.
 * Default false. Set CONTACT_DISCOVERY_REBUILD_MODE=true only in local .env.
 */
export function isContactDiscoveryRebuildMode(
  configService: ConfigService,
): boolean {
  return configService.get<boolean>('CONTACT_DISCOVERY_REBUILD_MODE') === true;
}

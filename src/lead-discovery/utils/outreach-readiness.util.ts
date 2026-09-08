import {
  ContactChannelStatus,
  ContactChannelType,
} from '../../generated/prisma/enums';

export type OutreachReadiness = 'LIMITED' | 'PARTIAL' | 'READY';

export type OutreachReadinessChannel = {
  type: ContactChannelType;
  status: ContactChannelStatus;
  isGeneric?: boolean | null;
};

/**
 * D1: READY is reserved for a future enrichment/correlation phase.
 * No channel activates READY in D1 — isGeneric=false does NOT mean personal email.
 */
export function computeOutreachReadiness(
  channels: OutreachReadinessChannel[],
): OutreachReadiness {
  const active = channels.filter(
    (channel) => channel.status === ContactChannelStatus.ACTIVE,
  );
  if (active.length === 0) {
    return 'LIMITED';
  }
  return 'PARTIAL';
}

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import 'reflect-metadata';

import {
  AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN,
  AGENCY_CONTACT_EMAILS_TIMEOUT_MS,
} from '../agency-discovery/agency-contact-emails-research.service';
import {
  AGENCY_CONTACT_PEOPLE_MAX_AGENCIES_PER_RUN,
  AGENCY_CONTACT_PEOPLE_TIMEOUT_MS,
} from '../agency-discovery/agency-contact-people-research.service';
import { AGENCY_DISCOVERY_DEFAULT_MAX_SERP_QUERIES } from '../agency-discovery/utils/build-agency-search-queries';
import {
  CONTACT_DISCOVERY_LOCK_DURATION_BREAKDOWN_MS,
  CONTACT_DISCOVERY_CONCURRENCY,
  CONTACT_DISCOVERY_LOCK_DURATION_MS,
} from './contact-discovery-worker.options';
import {
  CONTACT_EMAIL_MASTRA_TIMEOUT_MS,
  CONTACT_PEOPLE_MASTRA_TIMEOUT_MS,
} from './orchestrator/contact-email-mastra.orchestrator';
import { ContactDiscoveryProcessor } from './processors/contact-discovery.processor';

/** Nest BullMQ SetMetadata key (@nestjs/bullmq bull.constants). */
const BULLMQ_WORKER_METADATA = 'bullmq:worker_metadata';

function workerOptionsOf(target: object): Record<string, unknown> {
  return (
    (Reflect.getMetadata(BULLMQ_WORKER_METADATA, target) as
      | Record<string, unknown>
      | undefined) ?? {}
  );
}

describe('CONTACT_DISCOVERY worker lock options (2C.4.6.1)', () => {
  it('budget equals known wait ceilings + people-pass + headroom (4140s)', () => {
    const b = CONTACT_DISCOVERY_LOCK_DURATION_BREAKDOWN_MS;
    expect(b.track2A).toBe(CONTACT_EMAIL_MASTRA_TIMEOUT_MS);
    expect(b.track2B).toBe(CONTACT_PEOPLE_MASTRA_TIMEOUT_MS);
    expect(b.agencyDiscoverySerpWorst).toBe(
      AGENCY_DISCOVERY_DEFAULT_MAX_SERP_QUERIES * 60_000,
    );
    expect(b.agencyEmailsPass).toBe(
      AGENCY_CONTACT_EMAILS_TIMEOUT_MS *
        AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN,
    );
    expect(b.agencyPeoplePass).toBe(
      AGENCY_CONTACT_PEOPLE_TIMEOUT_MS *
        AGENCY_CONTACT_PEOPLE_MAX_AGENCIES_PER_RUN,
    );
    expect(b.headroom).toBe(300_000);
    expect(b.total).toBe(4_140_000);
    expect(CONTACT_DISCOVERY_LOCK_DURATION_MS).toBe(4_140_000);
    expect(
      b.track2A +
        b.track2B +
        b.agencyDiscoverySerpWorst +
        b.agencyEmailsPass +
        b.agencyPeoplePass +
        b.headroom,
    ).toBe(CONTACT_DISCOVERY_LOCK_DURATION_MS);
  });

  it('people-pass agency cap is independent from emails-pass (both default 5)', () => {
    expect(AGENCY_CONTACT_EMAILS_MAX_AGENCIES_PER_RUN).toBe(5);
    expect(AGENCY_CONTACT_PEOPLE_MAX_AGENCIES_PER_RUN).toBe(5);
    expect(AGENCY_CONTACT_EMAILS_TIMEOUT_MS).toBe(300_000);
    expect(AGENCY_CONTACT_PEOPLE_TIMEOUT_MS).toBe(300_000);
  });

  it('ContactDiscoveryProcessor declares lockDuration = operational budget', () => {
    const workerOpts = workerOptionsOf(ContactDiscoveryProcessor);
    expect(workerOpts).toEqual({
      lockDuration: CONTACT_DISCOVERY_LOCK_DURATION_MS,
      concurrency: CONTACT_DISCOVERY_CONCURRENCY,
    });
    // Renewal stays on BullMQ defaults — we must not set lockRenewTime: 0.
    expect(workerOpts).not.toHaveProperty('lockRenewTime');
    expect(workerOpts).not.toHaveProperty('stalledInterval');
  });

  it('does not disable BullMQ automatic lock renewal', () => {
    const workerOpts = workerOptionsOf(ContactDiscoveryProcessor);
    // lockRenewTime omitted → Worker defaults to lockDuration/2 (> 0) → LockManager starts.
    expect(workerOpts.lockRenewTime).toBeUndefined();
    expect(CONTACT_DISCOVERY_LOCK_DURATION_MS / 2).toBe(2_070_000);
  });

  it('other processors stay without CONTACT_DISCOVERY lockDuration (source isolation)', () => {
    const roots = join(__dirname, '..');
    const others = [
      'brand-discovery/processors/find-brands.processor.ts',
      'ai-execution/ai-execution-result.processor.ts',
      'ai-execution/ai-execution-event.processor.ts',
      'ideal-brand-profiles/processors/generate-ideal-brand-profile.processor.ts',
    ];
    for (const rel of others) {
      const src = readFileSync(join(roots, rel), 'utf8');
      expect(src).not.toContain('CONTACT_DISCOVERY_LOCK_DURATION_MS');
      expect(src).not.toContain('lockDuration:');
    }
  });
});

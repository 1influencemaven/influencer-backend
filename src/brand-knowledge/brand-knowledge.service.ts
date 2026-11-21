import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPathScopedHost,
  normalizeDomain,
} from '../brand-discovery/utils/brand-domain.util';
import { isNoiseHost } from '../brand-discovery/utils/brand-serp-hit-filter.util';
import { resolveNicheKeys } from '../brand-discovery/utils/brand-sector-taxonomy.util';

/** Max niche keys derived from the influencer when the candidate sector does not map. */
export const BKB_MAX_FALLBACK_NICHES = 3;
/** Max evidence URLs kept per brand. */
export const BKB_MAX_EVIDENCE_URLS = 5;

export type BrandKnowledgeCandidate = {
  name: string;
  website: string;
  domain?: string | null;
  sector?: string | null;
  market?: string | null;
  brandSize?: string | null;
  score?: number | null;
  evidenceUrls?: string[] | null;
  evidenceStatus?: string | null;
  source?: string | null;
  /** `metadata.groundingSource` when present. MODEL_PRIOR never feeds the base. */
  groundingSource?: string | null;
};

export type BrandDecisionStatus =
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTPONED';

export type DecisionDeltas = {
  approved: number;
  rejected: number;
  postponed: number;
};

/** Counter deltas of a review-status transition (UNDER_REVIEW carries no counter). */
export function decisionDeltas(
  from: BrandDecisionStatus,
  to: BrandDecisionStatus,
): DecisionDeltas {
  const one = (status: BrandDecisionStatus, target: BrandDecisionStatus) =>
    status === target ? 1 : 0;
  if (from === to) return { approved: 0, rejected: 0, postponed: 0 };
  return {
    approved: one(to, 'APPROVED') - one(from, 'APPROVED'),
    rejected: one(to, 'REJECTED') - one(from, 'REJECTED'),
    postponed: one(to, 'POSTPONED') - one(from, 'POSTPONED'),
  };
}

/**
 * Shared (cross-manager) brand memory. Every write is best-effort: a failure
 * here is logged and swallowed so it can never fail a discovery run or a
 * review action.
 */
@Injectable()
export class BrandKnowledgeService {
  private readonly logger = new Logger(BrandKnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical domain for a brand, or null when it must not enter the base
   * (empty, link-in-bio hosts that collide across brands, known noise hosts).
   */
  canonicalDomain(candidate: {
    website?: string | null;
    domain?: string | null;
  }): string | null {
    const raw = (candidate.domain || candidate.website || '').trim();
    if (!raw) return null;
    const domain = normalizeDomain(raw).replace(/\.$/, '');
    if (!domain || !domain.includes('.')) return null;
    if (isPathScopedHost(domain) || isNoiseHost(domain)) return null;
    return domain;
  }

  /**
   * Niche keys for a candidate: its own sector first; the influencer's niches
   * only as a bounded fallback so a brand is not tagged with every niche of
   * every talent that happened to surface it.
   */
  nicheKeysFor(
    candidate: { sector?: string | null },
    influencerTerms: ReadonlyArray<string | null | undefined>,
  ): string[] {
    const own = resolveNicheKeys([candidate.sector]).nicheKeys;
    if (own.length > 0) return own;
    return resolveNicheKeys(influencerTerms).nicheKeys.slice(
      0,
      BKB_MAX_FALLBACK_NICHES,
    );
  }

  private isEligible(candidate: BrandKnowledgeCandidate): boolean {
    return candidate.groundingSource !== 'MODEL_PRIOR';
  }

  /** Brand + per-niche surfaced/score counters for freshly persisted candidates. */
  async recordSurfaced(args: {
    influencerTerms: ReadonlyArray<string | null | undefined>;
    candidates: BrandKnowledgeCandidate[];
  }): Promise<void> {
    for (const candidate of args.candidates) {
      try {
        if (!this.isEligible(candidate)) continue;
        const domain = this.canonicalDomain(candidate);
        if (!domain) continue;
        const nicheKeys = this.nicheKeysFor(candidate, args.influencerTerms);
        const brandId = await this.upsertBrand(domain, candidate);
        for (const nicheKey of nicheKeys) {
          await this.upsertAffinity(brandId, nicheKey, {
            surfaced: 1,
            score: candidate.score ?? null,
            approved: 0,
            rejected: 0,
            postponed: 0,
            decision: false,
          });
        }
      } catch (error) {
        this.logFailure('recordSurfaced', error);
      }
    }
  }

  /** Applies the counter delta of a review decision (idempotent per transition). */
  async recordDecision(args: {
    candidate: BrandKnowledgeCandidate;
    influencerTerms: ReadonlyArray<string | null | undefined>;
    from: BrandDecisionStatus;
    to: BrandDecisionStatus;
  }): Promise<void> {
    try {
      const deltas = decisionDeltas(args.from, args.to);
      if (!deltas.approved && !deltas.rejected && !deltas.postponed) return;
      if (!this.isEligible(args.candidate)) return;
      const domain = this.canonicalDomain(args.candidate);
      if (!domain) return;
      const nicheKeys = this.nicheKeysFor(args.candidate, args.influencerTerms);
      const brandId = await this.upsertBrand(domain, args.candidate);
      for (const nicheKey of nicheKeys) {
        await this.upsertAffinity(brandId, nicheKey, {
          surfaced: 0,
          score: null,
          approved: deltas.approved,
          rejected: deltas.rejected,
          postponed: deltas.postponed,
          decision: true,
        });
      }
    } catch (error) {
      this.logFailure('recordDecision', error);
    }
  }

  /**
   * Rebuilds brands and affinities from the existing BrandCandidate rows.
   * Aggregates in memory and overwrites counters, so running it twice yields
   * identical data. Skips MODEL_PRIOR, noise hosts and never-reviewed legacy
   * rows without an evidence assessment.
   */
  async rebuildFromCandidates(): Promise<{
    candidatesScanned: number;
    brands: number;
    affinities: number;
    skipped: number;
  }> {
    type Agg = {
      candidate: BrandKnowledgeCandidate;
      lastSeenAt: Date;
      firstSeenAt: Date;
      niches: Map<
        string,
        {
          surfaced: number;
          scoreSum: number;
          scored: number;
          lastScore: number | null;
          approved: number;
          rejected: number;
          postponed: number;
          lastSurfacedAt: Date;
        }
      >;
    };
    const byDomain = new Map<string, Agg>();
    let scanned = 0;
    let skipped = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.brandCandidate.findMany({
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          website: true,
          domain: true,
          sector: true,
          market: true,
          brandSize: true,
          score: true,
          evidenceUrls: true,
          evidenceStatus: true,
          source: true,
          status: true,
          metadata: true,
          createdAt: true,
          influencer: { select: { niche: true, subNiche: true, niches: true } },
        },
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

      for (const row of page) {
        scanned += 1;
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const candidate: BrandKnowledgeCandidate = {
          ...row,
          groundingSource:
            typeof meta.groundingSource === 'string'
              ? meta.groundingSource
              : null,
        };
        const domain = this.canonicalDomain(candidate);
        const neverAssessed =
          row.evidenceStatus === 'NOT_ASSESSED' &&
          row.status === 'UNDER_REVIEW';
        if (!domain || !this.isEligible(candidate) || neverAssessed) {
          skipped += 1;
          continue;
        }
        const terms = [
          row.influencer?.niche,
          row.influencer?.subNiche,
          ...(row.influencer?.niches ?? []),
        ];
        const nicheKeys = this.nicheKeysFor(candidate, terms);
        let agg = byDomain.get(domain);
        if (!agg) {
          agg = {
            candidate,
            lastSeenAt: row.createdAt,
            firstSeenAt: row.createdAt,
            niches: new Map(),
          };
          byDomain.set(domain, agg);
        }
        if (row.createdAt > agg.lastSeenAt) {
          agg.lastSeenAt = row.createdAt;
          agg.candidate = candidate;
        }
        if (row.createdAt < agg.firstSeenAt) agg.firstSeenAt = row.createdAt;

        for (const nicheKey of nicheKeys) {
          const n = agg.niches.get(nicheKey) ?? {
            surfaced: 0,
            scoreSum: 0,
            scored: 0,
            lastScore: null,
            approved: 0,
            rejected: 0,
            postponed: 0,
            lastSurfacedAt: row.createdAt,
          };
          n.surfaced += 1;
          if (typeof row.score === 'number') {
            n.scoreSum += row.score;
            n.scored += 1;
            n.lastScore = row.score;
          }
          if (row.status === 'APPROVED') n.approved += 1;
          if (row.status === 'REJECTED') n.rejected += 1;
          if (row.status === 'POSTPONED') n.postponed += 1;
          if (row.createdAt > n.lastSurfacedAt) n.lastSurfacedAt = row.createdAt;
          agg.niches.set(nicheKey, n);
        }
      }
    }

    let affinities = 0;
    for (const [domain, agg] of byDomain) {
      const brandId = await this.upsertBrand(domain, agg.candidate, {
        firstSeenAt: agg.firstSeenAt,
        lastSeenAt: agg.lastSeenAt,
      });
      for (const [nicheKey, n] of agg.niches) {
        await this.prisma.$executeRaw`
          INSERT INTO "BrandNicheAffinity" AS t
            ("id","brandId","nicheKey","surfacedCount","approvedCount","rejectedCount",
             "postponedCount","scoreSum","scoredCount","avgScore","lastScore",
             "lastSurfacedAt","createdAt","updatedAt")
          VALUES (gen_random_uuid()::text, ${brandId}, ${nicheKey}, ${n.surfaced},
                  ${n.approved}, ${n.rejected}, ${n.postponed}, ${n.scoreSum},
                  ${n.scored}, ${n.scored > 0 ? n.scoreSum / n.scored : 0},
                  ${n.lastScore}, ${n.lastSurfacedAt}, NOW(), NOW())
          ON CONFLICT ("brandId","nicheKey") DO UPDATE SET
            "surfacedCount" = EXCLUDED."surfacedCount",
            "approvedCount" = EXCLUDED."approvedCount",
            "rejectedCount" = EXCLUDED."rejectedCount",
            "postponedCount" = EXCLUDED."postponedCount",
            "scoreSum" = EXCLUDED."scoreSum",
            "scoredCount" = EXCLUDED."scoredCount",
            "avgScore" = EXCLUDED."avgScore",
            "lastScore" = EXCLUDED."lastScore",
            "lastSurfacedAt" = EXCLUDED."lastSurfacedAt",
            "updatedAt" = NOW()`;
        affinities += 1;
      }
    }

    return {
      candidatesScanned: scanned,
      brands: byDomain.size,
      affinities,
      skipped,
    };
  }

  private async upsertBrand(
    domain: string,
    candidate: BrandKnowledgeCandidate,
    seen?: { firstSeenAt: Date; lastSeenAt: Date },
  ): Promise<string> {
    const sectors = candidate.sector ? [candidate.sector.trim()] : [];
    const markets = candidate.market ? [candidate.market.trim()] : [];
    const evidence = (candidate.evidenceUrls ?? []).slice(
      0,
      BKB_MAX_EVIDENCE_URLS,
    );
    // Verified only by fresh web evidence; KB-sourced rows never refresh it.
    const verifiedAt =
      candidate.evidenceStatus === 'VERIFIED' && candidate.source !== 'kb'
        ? new Date()
        : null;
    const firstSeen = seen?.firstSeenAt ?? new Date();
    const lastSeen = seen?.lastSeenAt ?? new Date();

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Brand" AS t
        ("id","domain","name","website","sectors","markets","sizeTag","evidenceUrls",
         "lastVerifiedAt","firstSeenAt","lastSeenAt","createdAt","updatedAt")
      VALUES (gen_random_uuid()::text, ${domain}, ${candidate.name},
              ${candidate.website}, ${sectors}::text[], ${markets}::text[],
              ${candidate.brandSize ?? null}, ${evidence}::text[], ${verifiedAt},
              ${firstSeen}, ${lastSeen}, NOW(), NOW())
      ON CONFLICT ("domain") DO UPDATE SET
        "name" = CASE WHEN t."name" = '' THEN EXCLUDED."name" ELSE t."name" END,
        "sectors" = ARRAY(SELECT DISTINCT u FROM unnest(t."sectors" || EXCLUDED."sectors") u),
        "markets" = ARRAY(SELECT DISTINCT u FROM unnest(t."markets" || EXCLUDED."markets") u),
        "sizeTag" = COALESCE(EXCLUDED."sizeTag", t."sizeTag"),
        "evidenceUrls" = ARRAY(
          SELECT q.u FROM (
            SELECT x.u, MIN(x.ord) AS ord
            FROM unnest(EXCLUDED."evidenceUrls" || t."evidenceUrls")
                 WITH ORDINALITY AS x(u, ord)
            GROUP BY x.u
          ) q ORDER BY q.ord LIMIT ${BKB_MAX_EVIDENCE_URLS}),
        "lastVerifiedAt" = COALESCE(EXCLUDED."lastVerifiedAt", t."lastVerifiedAt"),
        "lastSeenAt" = GREATEST(t."lastSeenAt", EXCLUDED."lastSeenAt"),
        "firstSeenAt" = LEAST(t."firstSeenAt", EXCLUDED."firstSeenAt"),
        "updatedAt" = NOW()
      RETURNING "id"`;
    return rows[0].id;
  }

  private async upsertAffinity(
    brandId: string,
    nicheKey: string,
    delta: {
      surfaced: number;
      score: number | null;
      approved: number;
      rejected: number;
      postponed: number;
      decision: boolean;
    },
  ): Promise<void> {
    const scoreInc = delta.score ?? 0;
    const scoredInc = delta.score == null ? 0 : 1;
    await this.prisma.$executeRaw`
      INSERT INTO "BrandNicheAffinity" AS t
        ("id","brandId","nicheKey","surfacedCount","approvedCount","rejectedCount",
         "postponedCount","scoreSum","scoredCount","avgScore","lastScore",
         "lastSurfacedAt","lastDecisionAt","createdAt","updatedAt")
      VALUES (gen_random_uuid()::text, ${brandId}, ${nicheKey},
              ${Math.max(delta.surfaced, delta.decision ? 1 : 0)},
              ${Math.max(delta.approved, 0)}, ${Math.max(delta.rejected, 0)},
              ${Math.max(delta.postponed, 0)}, ${scoreInc}, ${scoredInc},
              ${scoredInc ? scoreInc : 0}, ${delta.score},
              NOW(), ${delta.decision ? new Date() : null}, NOW(), NOW())
      ON CONFLICT ("brandId","nicheKey") DO UPDATE SET
        "surfacedCount" = t."surfacedCount" + ${delta.surfaced},
        "approvedCount" = GREATEST(0, t."approvedCount" + ${delta.approved}),
        "rejectedCount" = GREATEST(0, t."rejectedCount" + ${delta.rejected}),
        "postponedCount" = GREATEST(0, t."postponedCount" + ${delta.postponed}),
        "scoreSum" = t."scoreSum" + ${scoreInc},
        "scoredCount" = t."scoredCount" + ${scoredInc},
        "avgScore" = CASE WHEN t."scoredCount" + ${scoredInc} > 0
          THEN (t."scoreSum" + ${scoreInc}) / (t."scoredCount" + ${scoredInc})
          ELSE 0 END,
        "lastScore" = COALESCE(${delta.score}, t."lastScore"),
        "lastSurfacedAt" = CASE WHEN ${delta.surfaced} > 0 THEN NOW() ELSE t."lastSurfacedAt" END,
        "lastDecisionAt" = CASE WHEN ${delta.decision} THEN NOW() ELSE t."lastDecisionAt" END,
        "updatedAt" = NOW()`;
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'brand_knowledge_write_failed',
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}


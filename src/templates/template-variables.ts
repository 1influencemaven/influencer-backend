/**
 * Template variable engine (HU-TPL-008/009/010): catalog, parser, validator,
 * resolver and Saleshandy export. Pure functions (no DB) so they are easy to
 * test; services load the data and call them.
 *
 * Keys are stable: `{{firstName}}` (CustomField.key) and `{{influencer.name}}`
 * (talent whitelist). Saleshandy writes merge tags with the field LABEL
 * (`{{First Name}}`, verified 2026-11-26), so export translates key → label.
 */
import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';

import type { CustomField, Influencer } from '../generated/prisma/client';
import { columnForFieldKey } from '../prospects/prospects.mapper';

export type VariableSource = 'influencer' | 'prospect' | 'custom';
export type VariableLocation = 'subject' | 'preHeader' | 'body';

export type VariableDefinition = {
  key: string;
  token: string;
  label: string;
  source: VariableSource;
  fieldType: string;
  fallbackText: string | null;
  isActive: boolean;
  disabledReason: string | null;
  fieldId: string | null;
};

type InfluencerVar = {
  key: string;
  label: { es: string; en: string };
  read: (i: InfluencerData) => string | null;
};

export type InfluencerData = Pick<
  Influencer,
  | 'name'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'countries'
  | 'language'
  | 'niche'
  | 'subNiche'
  | 'niches'
  | 'followers'
  | 'engagement'
  | 'email'
  | 'outgoingEmail'
  | 'mediaKitUrl'
>;

const handle = (v: string | null) =>
  v ? (v.startsWith('@') || v.includes('/') ? v : `@${v}`) : null;

/** Explicit whitelist: never expose internal fields (ids, manager, evidence). */
export const INFLUENCER_VARIABLES: InfluencerVar[] = [
  {
    key: 'influencer.name',
    label: { es: 'Nombre del talento', en: 'Talent name' },
    read: (i) => i.name,
  },
  {
    key: 'influencer.instagram',
    label: { es: 'Instagram', en: 'Instagram' },
    read: (i) => handle(i.instagram),
  },
  {
    key: 'influencer.tiktok',
    label: { es: 'TikTok', en: 'TikTok' },
    read: (i) => handle(i.tiktok),
  },
  {
    key: 'influencer.youtube',
    label: { es: 'YouTube', en: 'YouTube' },
    read: (i) => i.youtube,
  },
  {
    key: 'influencer.followers',
    label: { es: 'Seguidores', en: 'Followers' },
    read: (i) =>
      typeof i.followers === 'number'
        ? i.followers.toLocaleString('en-US')
        : null,
  },
  {
    key: 'influencer.engagement',
    label: { es: 'Engagement (%)', en: 'Engagement (%)' },
    read: (i) =>
      i.engagement !== null && i.engagement !== undefined
        ? `${Number(i.engagement)}%`
        : null,
  },
  {
    key: 'influencer.niche',
    label: { es: 'Nicho', en: 'Niche' },
    read: (i) => i.niche ?? i.niches[0] ?? null,
  },
  {
    key: 'influencer.subNiche',
    label: { es: 'Subnicho', en: 'Sub-niche' },
    read: (i) => i.subNiche,
  },
  {
    key: 'influencer.niches',
    label: { es: 'Nichos', en: 'Niches' },
    read: (i) => (i.niches.length ? i.niches.join(', ') : null),
  },
  {
    key: 'influencer.country',
    label: { es: 'País', en: 'Country' },
    // Talent countries are an ISO array since 2026-11-26 (key kept stable).
    read: (i) => (i.countries.length ? i.countries.join(', ') : null),
  },
  {
    key: 'influencer.language',
    label: { es: 'Idioma', en: 'Language' },
    read: (i) => i.language,
  },
  {
    key: 'influencer.mediaKitUrl',
    label: { es: 'Media kit', en: 'Media kit' },
    read: (i) => i.mediaKitUrl,
  },
  {
    key: 'influencer.outgoingEmail',
    label: { es: 'Correo de salida', en: 'Outgoing email' },
    read: (i) => i.outgoingEmail,
  },
  {
    key: 'influencer.email',
    label: { es: 'Correo del talento', en: 'Talent email' },
    read: (i) => i.email,
  },
];
const INFLUENCER_BY_KEY = new Map(INFLUENCER_VARIABLES.map((v) => [v.key, v]));

export function buildCatalog(
  fields: CustomField[],
  locale: 'es' | 'en' = 'es',
): VariableDefinition[] {
  return [
    ...INFLUENCER_VARIABLES.map((v) => ({
      key: v.key,
      token: `{{${v.key}}}`,
      label: v.label[locale],
      source: 'influencer' as const,
      fieldType: 'text',
      fallbackText: null,
      isActive: true,
      disabledReason: null,
      fieldId: null,
    })),
    ...fields
      .filter((f) => f.disabledReason !== 'REMOVED_IN_SALESHANDY' || f.isActive)
      .map((f) => ({
        key: f.key,
        token: `{{${f.key}}}`,
        label: f.label,
        source:
          f.origin === 'SYSTEM' ? ('prospect' as const) : ('custom' as const),
        fieldType: f.fieldType.toLowerCase().replace('_', '-'),
        fallbackText: f.fallbackText,
        isActive: f.isActive,
        disabledReason: f.disabledReason,
        fieldId: f.id,
      })),
  ];
}

// ---------------------------------------------------------------- parsing

const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const VALID_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;
/** Editor chip: <span data-variable-key="k" ...>…</span> */
const CHIP_RE =
  /<span\b[^>]*\bdata-variable-key="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi;

export type FoundVariable = {
  key: string;
  raw: string;
  location: VariableLocation;
};

/** Replaces editor chips with plain `{{key}}` tokens (used before resolving/exporting). */
export function chipsToTokens(html: string): string {
  return html.replace(CHIP_RE, (_m, key: string) => `{{${key}}}`);
}

export function extractVariables(parts: {
  subject: string;
  preHeader?: string | null;
  bodyHtml: string;
}) {
  const found: FoundVariable[] = [];
  const malformed: Array<{ raw: string; location: VariableLocation }> = [];
  const scan = (text: string, location: VariableLocation) => {
    for (const m of text.matchAll(TOKEN_RE))
      found.push({ key: m[1].trim(), raw: m[0], location });
    // `{{` without a closing `}}`, or `}}` without opening, after removing valid tokens.
    const rest = text.replace(TOKEN_RE, '');
    if (/\{\{|\}\}/.test(rest))
      malformed.push({
        raw: (rest.match(/\{\{[^}]{0,40}|[^{]{0,40}\}\}/) ?? [''])[0],
        location,
      });
  };
  scan(parts.subject, 'subject');
  if (parts.preHeader) scan(parts.preHeader, 'preHeader');
  scan(chipsToTokens(parts.bodyHtml), 'body');
  return { found, malformed };
}

// ------------------------------------------------------------- validation

export type VariableIssueCode =
  | 'MALFORMED_TOKEN'
  | 'INVALID_KEY'
  | 'UNKNOWN_VARIABLE'
  | 'FIELD_DISABLED'
  | 'FIELD_REMOVED_IN_SALESHANDY';

export type VariableIssue = {
  code: VariableIssueCode;
  severity: 'error' | 'warning';
  key: string | null;
  raw: string;
  location: VariableLocation;
};

export function validateVariables(
  parts: { subject: string; preHeader?: string | null; bodyHtml: string },
  fields: CustomField[],
) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const { found, malformed } = extractVariables(parts);
  const issues: VariableIssue[] = malformed.map((m) => ({
    code: 'MALFORMED_TOKEN',
    severity: 'error',
    key: null,
    raw: m.raw,
    location: m.location,
  }));
  const usedFields = new Map<
    string,
    { field: CustomField; locations: Set<VariableLocation> }
  >();
  const influencerKeys = new Set<string>();
  for (const v of found) {
    if (!VALID_KEY_RE.test(v.key)) {
      issues.push({
        code: 'INVALID_KEY',
        severity: 'error',
        key: v.key,
        raw: v.raw,
        location: v.location,
      });
      continue;
    }
    if (v.key.startsWith('influencer.')) {
      if (INFLUENCER_BY_KEY.has(v.key)) influencerKeys.add(v.key);
      else
        issues.push({
          code: 'UNKNOWN_VARIABLE',
          severity: 'error',
          key: v.key,
          raw: v.raw,
          location: v.location,
        });
      continue;
    }
    const field = byKey.get(v.key);
    if (!field) {
      issues.push({
        code: 'UNKNOWN_VARIABLE',
        severity: 'error',
        key: v.key,
        raw: v.raw,
        location: v.location,
      });
      continue;
    }
    if (!field.isActive) {
      const removed = field.disabledReason === 'REMOVED_IN_SALESHANDY';
      issues.push({
        code: removed ? 'FIELD_REMOVED_IN_SALESHANDY' : 'FIELD_DISABLED',
        severity: removed ? 'error' : 'warning',
        key: v.key,
        raw: v.raw,
        location: v.location,
      });
    }
    const entry = usedFields.get(field.id) ?? {
      field,
      locations: new Set<VariableLocation>(),
    };
    entry.locations.add(v.location);
    usedFields.set(field.id, entry);
  }
  return {
    valid: issues.length === 0,
    issues,
    influencerKeys: [...influencerKeys],
    fieldReferences: [...usedFields.values()].map(({ field, locations }) => ({
      customFieldId: field.id,
      variableKey: field.key,
      locations: [...locations],
    })),
  };
}

// --------------------------------------------------------- html handling

/** Email-safe allowlist (HU-TPL-005 CA-03): formatting, lists, links, alignment, variable chips. */
export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'a',
      'span',
      'div',
      'h1',
      'h2',
      'h3',
      'blockquote',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['data-type', 'data-variable-key', 'data-label', 'class'],
      '*': ['style'],
    },
    allowedStyles: { '*': { 'text-align': [/^(left|right|center|justify)$/] } },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
          ...(attribs.target ? { target: '_blank' } : {}),
        },
      }),
    },
  });
}

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
    ],
  }).trim();
}

/** True when the body has no visible text and no variables. */
export function isEmptyBody(html: string): boolean {
  return htmlToPlainText(chipsToTokens(html)).replace(/\s+/g, '') === '';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ------------------------------------------------------------- resolving

export type ProspectData = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  website: string | null;
  linkedInUrl: string | null;
  country: string | null;
  phoneNumber: string | null;
  /** customFieldId → value */
  customValues: Map<string, string>;
};

export type ResolutionNote = {
  key: string;
  label: string;
  location: VariableLocation;
  source: VariableSource;
};

export type ResolvedTemplate = {
  subject: string;
  preHeader: string | null;
  bodyHtml: string;
  bodyText: string;
  usedFallbacks: Array<ResolutionNote & { value: string }>;
  unresolved: ResolutionNote[];
};

/**
 * Resolves every variable (HU-TPL-010). Values are HTML-escaped in the body and
 * stripped of line breaks in subject/pre-header. Never mutates the template.
 */
export function resolveTemplate(
  parts: { subject: string; preHeader?: string | null; bodyHtml: string },
  ctx: {
    influencer: InfluencerData | null;
    prospect: ProspectData | null;
    fields: CustomField[];
  },
  options: { highlightMissing?: boolean } = {},
): ResolvedTemplate {
  const byKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const usedFallbacks: ResolvedTemplate['usedFallbacks'] = [];
  const unresolved: ResolutionNote[] = [];

  const lookup = (key: string, location: VariableLocation): string | null => {
    if (key.startsWith('influencer.')) {
      const def = INFLUENCER_BY_KEY.get(key);
      const value = def && ctx.influencer ? def.read(ctx.influencer) : null;
      if (value) return value;
      unresolved.push({
        key,
        label: def?.label.es ?? key,
        location,
        source: 'influencer',
      });
      return null;
    }
    const field = byKey.get(key);
    const source: VariableSource =
      field?.origin === 'SYSTEM' ? 'prospect' : 'custom';
    let value: string | null = null;
    if (field && ctx.prospect) {
      const column = columnForFieldKey(field.systemMapping ?? field.key);
      value = column
        ? ((ctx.prospect as unknown as Record<string, string | null>)[column] ??
          null)
        : (ctx.prospect.customValues.get(field.id) ?? null);
    }
    if (value && value.trim()) return value;
    if (field?.fallbackText) {
      usedFallbacks.push({
        key,
        label: field.label,
        location,
        source,
        value: field.fallbackText,
      });
      return field.fallbackText;
    }
    unresolved.push({ key, label: field?.label ?? key, location, source });
    return null;
  };

  const plain = (text: string, location: VariableLocation) =>
    text.replace(TOKEN_RE, (_m, raw: string) =>
      (lookup(raw.trim(), location) ?? '').replace(/[\r\n]+/g, ' '),
    );

  const body = chipsToTokens(parts.bodyHtml).replace(
    TOKEN_RE,
    (_m, raw: string) => {
      const key = raw.trim();
      const value = lookup(key, 'body');
      if (value !== null) return escapeHtml(value);
      return options.highlightMissing
        ? `<mark data-unresolved-variable="${escapeHtml(key)}">[${escapeHtml(key)}]</mark>`
        : '';
    },
  );

  const bodyHtml = options.highlightMissing ? body : sanitizeTemplateHtml(body);
  return {
    subject: plain(parts.subject, 'subject'),
    preHeader: parts.preHeader ? plain(parts.preHeader, 'preHeader') : null,
    bodyHtml,
    bodyText: htmlToPlainText(body.replace(/<mark[^>]*>(.*?)<\/mark>/g, '$1')),
    usedFallbacks,
    unresolved,
  };
}

// ---------------------------------------------------------------- export

/**
 * Prepares a template for a Saleshandy sequence step: talent variables are
 * filled in (Saleshandy does not know them) and field keys become Saleshandy
 * merge tags by label (`{{firstName}}` → `{{First Name}}`).
 */
export function compileForSaleshandy(
  parts: { subject: string; preHeader?: string | null; bodyHtml: string },
  ctx: { influencer: InfluencerData | null; fields: CustomField[] },
) {
  const byKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const missingInfluencer = new Set<string>();
  const unknown = new Set<string>();
  const swap = (raw: string, escape: boolean) => {
    const key = raw.trim();
    if (key.startsWith('influencer.')) {
      const def = INFLUENCER_BY_KEY.get(key);
      const value = def && ctx.influencer ? def.read(ctx.influencer) : null;
      if (!value) missingInfluencer.add(key);
      return value ? (escape ? escapeHtml(value) : value) : '';
    }
    const field = byKey.get(key);
    if (!field) {
      unknown.add(key);
      return `{{${key}}}`;
    }
    return `{{${field.label}}}`;
  };
  const text = (s: string) =>
    s.replace(TOKEN_RE, (_m, raw: string) => swap(raw, false));
  return {
    subject: text(parts.subject),
    preheader: parts.preHeader ? text(parts.preHeader) : null,
    content: chipsToTokens(parts.bodyHtml).replace(
      TOKEN_RE,
      (_m, raw: string) => swap(raw, true),
    ),
    missingInfluencerValues: [...missingInfluencer],
    unknownVariables: [...unknown],
  };
}

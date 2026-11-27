import type { CustomField } from '../generated/prisma/client';
import {
  buildCatalog,
  chipsToTokens,
  compileForSaleshandy,
  extractVariables,
  htmlToPlainText,
  isEmptyBody,
  resolveTemplate,
  sanitizeTemplateHtml,
  validateVariables,
  type InfluencerData,
  type ProspectData,
} from './template-variables';

const field = (over: Partial<CustomField>): CustomField =>
  ({
    id: over.key ?? 'f',
    key: 'firstName',
    label: 'First Name',
    fieldType: 'TEXT',
    origin: 'SYSTEM',
    fallbackText: null,
    saleshandyFieldId: 'sh',
    systemMapping: null,
    metadata: null,
    tags: [],
    isActive: true,
    disabledReason: null,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as CustomField;

const FIELDS = [
  field({
    id: 'f-first',
    key: 'firstName',
    label: 'First Name',
    systemMapping: 'firstName',
    fallbackText: 'equipo',
  }),
  field({
    id: 'f-company',
    key: 'company',
    label: 'Company',
    systemMapping: 'company',
  }),
  field({
    id: 'f-overview',
    key: 'prospectOverview',
    label: 'Prospect Overview',
    origin: 'CUSTOM',
  }),
  field({
    id: 'f-old',
    key: 'oldField',
    label: 'Old',
    origin: 'CUSTOM',
    isActive: false,
    disabledReason: 'MANUAL',
  }),
  field({
    id: 'f-gone',
    key: 'goneField',
    label: 'Gone',
    origin: 'CUSTOM',
    isActive: false,
    disabledReason: 'REMOVED_IN_SALESHANDY',
  }),
];

const influencer: InfluencerData = {
  name: 'Sofía Ríos',
  instagram: 'sofiarios',
  tiktok: null,
  youtube: null,
  countries: ['MX'],
  language: 'es',
  niche: 'beauty',
  subNiche: null,
  niches: ['beauty', 'lifestyle'],
  followers: 180000,
  engagement: null as never,
  email: null,
  outgoingEmail: 'sofia@talent.com',
  mediaKitUrl: null,
};

const prospect = (over: Partial<ProspectData> = {}): ProspectData => ({
  email: 'laura@pixi.com',
  firstName: 'Laura',
  lastName: null,
  jobTitle: null,
  company: 'Pixi',
  companyDomain: null,
  website: null,
  linkedInUrl: null,
  country: null,
  phoneNumber: null,
  customValues: new Map([['f-overview', 'Marca <clave>']]),
  ...over,
});

const chip = (key: string) =>
  `<span data-type="template-variable" data-variable-key="${key}">{{${key}}}</span>`;

describe('catalog', () => {
  it('groups influencer, prospect (system) and custom fields; hides fields removed in Saleshandy', () => {
    const catalog = buildCatalog(FIELDS);
    expect(catalog.find((v) => v.key === 'influencer.name')).toMatchObject({
      source: 'influencer',
      token: '{{influencer.name}}',
    });
    expect(catalog.find((v) => v.key === 'firstName')).toMatchObject({
      source: 'prospect',
      fallbackText: 'equipo',
    });
    expect(catalog.find((v) => v.key === 'prospectOverview')?.source).toBe(
      'custom',
    );
    expect(catalog.find((v) => v.key === 'oldField')?.isActive).toBe(false);
    expect(catalog.find((v) => v.key === 'goneField')).toBeUndefined();
  });
});

describe('parse + validate', () => {
  it('finds variables in subject, pre-header and body chips with their location', () => {
    const { found } = extractVariables({
      subject: 'Hola {{ firstName }}',
      preHeader: 'De {{influencer.name}}',
      bodyHtml: `<p>${chip('company')} y {{prospectOverview}}</p>`,
    });
    expect(found.map((f) => [f.key, f.location])).toEqual([
      ['firstName', 'subject'],
      ['influencer.name', 'preHeader'],
      ['company', 'body'],
      ['prospectOverview', 'body'],
    ]);
  });

  it('reports unknown, disabled, removed, invalid and malformed variables with location', () => {
    const result = validateVariables(
      {
        subject: 'Hi {{firstName}} {{nope}}',
        preHeader: '{{influencer.secret}} {{oldField}}',
        bodyHtml: '<p>{{goneField}} {{bad key}} {{firstName</p>',
      },
      FIELDS,
    );
    expect(
      result.issues.map((i) => [i.code, i.key, i.location, i.severity]),
    ).toEqual([
      ['MALFORMED_TOKEN', null, 'body', 'error'],
      ['UNKNOWN_VARIABLE', 'nope', 'subject', 'error'],
      ['UNKNOWN_VARIABLE', 'influencer.secret', 'preHeader', 'error'],
      ['FIELD_DISABLED', 'oldField', 'preHeader', 'warning'],
      ['FIELD_REMOVED_IN_SALESHANDY', 'goneField', 'body', 'error'],
      ['INVALID_KEY', 'bad key', 'body', 'error'],
    ]);
    // Disabled/removed fields keep their references (HU-TPL-002 CA-04).
    expect(result.fieldReferences.map((r) => r.variableKey).sort()).toEqual([
      'firstName',
      'goneField',
      'oldField',
    ]);
  });

  it('merges locations per field and lists influencer variables separately', () => {
    const result = validateVariables(
      {
        subject: '{{firstName}}',
        bodyHtml: `<p>${chip('firstName')} ${chip('influencer.instagram')}</p>`,
      },
      FIELDS,
    );
    expect(result.valid).toBe(true);
    expect(result.fieldReferences).toEqual([
      {
        customFieldId: 'f-first',
        variableKey: 'firstName',
        locations: ['subject', 'body'],
      },
    ]);
    expect(result.influencerKeys).toEqual(['influencer.instagram']);
  });
});

describe('sanitize (XSS)', () => {
  it('keeps email-safe formatting, links, alignment and variable chips', () => {
    const html = sanitizeTemplateHtml(
      `<p style="text-align:center"><strong>Hola</strong> <a href="https://x.com" target="_blank">link</a></p><ul><li>uno</li></ul>${chip('firstName')}`,
    );
    expect(html).toContain(
      '<p style="text-align:center"><strong>Hola</strong>',
    );
    expect(html).toContain('href="https://x.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-variable-key="firstName"');
  });

  it('removes scripts, event handlers, javascript: links and arbitrary styles', () => {
    const html = sanitizeTemplateHtml(
      '<p onclick="x()" style="position:fixed;color:red">a</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">b</a><iframe src="https://evil"></iframe>',
    );
    expect(html).not.toMatch(
      /script|onerror|onclick|javascript:|iframe|position|<img/i,
    );
  });

  it('detects empty bodies and builds plain text', () => {
    expect(isEmptyBody('<p><br></p>')).toBe(true);
    expect(isEmptyBody(`<p>${chip('firstName')}</p>`)).toBe(false);
    expect(htmlToPlainText('<p>Hola</p><ul><li>uno</li></ul>')).toBe(
      'Hola\n\n * uno',
    );
  });
});

describe('resolve', () => {
  const parts = {
    subject: 'Hola {{firstName}}, soy {{influencer.name}}',
    preHeader: '{{influencer.followers}} seguidores',
    bodyHtml: `<p>${chip('company')}: ${chip('prospectOverview')} {{influencer.mediaKitUrl}}</p>`,
  };

  it('replaces influencer, prospect and custom values and escapes HTML', () => {
    const r = resolveTemplate(
      parts,
      { influencer, prospect: prospect(), fields: FIELDS },
      { highlightMissing: false },
    );
    expect(r.subject).toBe('Hola Laura, soy Sofía Ríos');
    expect(r.preHeader).toBe('180,000 seguidores');
    expect(r.bodyHtml).toBe('<p>Pixi: Marca &lt;clave&gt; </p>');
    expect(r.unresolved).toEqual([
      {
        key: 'influencer.mediaKitUrl',
        label: 'Media kit',
        location: 'body',
        source: 'influencer',
      },
    ]);
  });

  it('uses fallbackText for missing values (generic mailbox) and highlights the rest', () => {
    const r = resolveTemplate(
      parts,
      {
        influencer,
        prospect: prospect({ firstName: null }),
        fields: FIELDS,
      },
      { highlightMissing: true },
    );
    expect(r.subject).toBe('Hola equipo, soy Sofía Ríos');
    expect(r.usedFallbacks).toEqual([
      {
        key: 'firstName',
        label: 'First Name',
        location: 'subject',
        source: 'prospect',
        value: 'equipo',
      },
    ]);
    expect(r.bodyHtml).toContain(
      '<mark data-unresolved-variable="influencer.mediaKitUrl">',
    );
  });

  it('never lets prospect values inject markup or headers', () => {
    const r = resolveTemplate(
      { subject: 'Hi {{firstName}}', bodyHtml: `<p>${chip('firstName')}</p>` },
      {
        influencer,
        prospect: prospect({
          firstName: '<img src=x onerror=alert(1)>\r\nBcc: x@y.com',
        }),
        fields: FIELDS,
      },
      { highlightMissing: false },
    );
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.bodyHtml).not.toContain('<img');
    expect(r.bodyHtml).toContain('&lt;img');
  });

  it('does not mutate the input', () => {
    const copy = { ...parts };
    resolveTemplate(parts, {
      influencer,
      prospect: prospect(),
      fields: FIELDS,
    });
    expect(parts).toEqual(copy);
  });
});

describe('compileForSaleshandy', () => {
  it('fills talent values and converts field keys to Saleshandy label merge tags', () => {
    const out = compileForSaleshandy(
      {
        subject: 'Hola {{firstName}} — {{influencer.name}}',
        preHeader: null,
        bodyHtml: `<p>${chip('company')} {{influencer.mediaKitUrl}} {{mystery}}</p>`,
      },
      { influencer, fields: FIELDS },
    );
    expect(out.subject).toBe('Hola {{First Name}} — Sofía Ríos');
    expect(out.content).toBe('<p>{{Company}}  {{mystery}}</p>');
    expect(out.missingInfluencerValues).toEqual(['influencer.mediaKitUrl']);
    expect(out.unknownVariables).toEqual(['mystery']);
  });

  it('chipsToTokens leaves plain HTML untouched', () => {
    expect(chipsToTokens('<p>Hola <span>x</span></p>')).toBe(
      '<p>Hola <span>x</span></p>',
    );
  });
});

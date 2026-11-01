const GENERIC_LOCAL_PARTS = new Set([
  'info',
  'hello',
  'hola',
  'contact',
  'contacto',
  'support',
  'soporte',
  'marketing',
  'sales',
  'press',
  'media',
  'partnerships',
  'partnership',
  'business',
  'careers',
  'hr',
  'admin',
  'help',
  'noreply',
  'no-reply',
  'prensa',
  'ventas',
  'affiliate',
  'affiliates',
  'creator',
  'creators',
  'collab',
  'collaborations',
  'influencer',
  'influencers',
  'ambassador',
  'ambassadors',
]);

export function classifyPublicEmailGeneric(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase().trim();
  if (!local) {
    return false;
  }
  return GENERIC_LOCAL_PARTS.has(local);
}

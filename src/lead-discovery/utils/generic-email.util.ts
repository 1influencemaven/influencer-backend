const GENERIC_LOCAL_PARTS = new Set([
  'info',
  'hola',
  'hello',
  'contact',
  'contacto',
  'support',
  'soporte',
  'admin',
  'sales',
  'ventas',
  'help',
  'noreply',
  'no-reply',
  'marketing',
  'prensa',
  'press',
]);

export function isGenericEmail(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase().trim();
  if (!local) {
    return false;
  }
  return GENERIC_LOCAL_PARTS.has(local);
}

import { ContactChannelType } from '../../generated/prisma/enums';

export function normalizeChannelValue(
  type: ContactChannelType,
  value: string,
): string {
  const trimmed = value.trim();
  if (type === ContactChannelType.EMAIL) {
    return trimmed.toLowerCase();
  }
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    const path = url.pathname.replace(/\/+$/, '') || '';
    return `${url.protocol}//${url.host}${path}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

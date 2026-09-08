import type { ProfilePublicEmailInput } from '../interfaces/public-email-evidence.interface';
import type { RawLeadContact } from '../interfaces/lead-source-provider.interface';

export function toProfilePublicEmailInput(
  contact: RawLeadContact,
): ProfilePublicEmailInput {
  const profileUrl = contact.profileUrl?.trim();
  if (!profileUrl) {
    throw new Error('profileUrl is required for public email discovery');
  }
  return {
    personName: contact.contactName,
    profileUrl,
    companyName: contact.companyName,
    companyLinkedInUrl: contact.companyLinkedInUrl,
    companyWebsite: contact.companyWebsite,
  };
}

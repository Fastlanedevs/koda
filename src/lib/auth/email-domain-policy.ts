const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '1t-mail.com',
  '20minutemail.com',
  'anonaddy.com',
  'anonymbox.com',
  'ai-debate.jp',
  'binkmail.com',
  'burnermail.io',
  'byom.de',
  'cryptogmail.com',
  'dispostable.com',
  'drafterplus.nl',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemail.net',
  'fexpost.com',
  'getairmail.com',
  'getnada.com',
  'gdte.site',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'inboxkitten.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailnull.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'tempmail.com',
  'tempmail.dev',
  'tempmail.io',
  'tempmail.jp',
  'tempmail.net',
  'tempmail.org',
  'temp-mail.io',
  'temp-mail.org',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'sutemail.com',
  'vhm.cc',
  'x-box.in',
  'yopmail.com',
]);

const DISPOSABLE_EMAIL_SUFFIXES = [
  '.mailinator.com',
  '.tempmail.com',
  '.temp-mail.org',
  '.yopmail.com',
];

export function getEmailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1).replace(/\.+$/, '');
}

export function isDisposableEmailDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.+$/, '');
  if (!normalized) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(normalized)) return true;
  return DISPOSABLE_EMAIL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function isBlockedDisposableEmail(email: string): boolean {
  const domain = getEmailDomain(email);
  return domain ? isDisposableEmailDomain(domain) : false;
}

export const DISPOSABLE_EMAIL_BLOCK_MESSAGE =
  'Disposable or temporary email addresses are not allowed. Use a permanent email address.';

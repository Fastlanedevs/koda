import 'server-only';

import type { BillingActor } from '@/lib/billing/internal-types';

export function isBillingAdmin(actor: BillingActor) {
  const allowed = (process.env.BILLING_ADMIN_USER_IDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowed.includes(actor.user.id)) {
    return true;
  }

  return actor.memberships.some((membership) => membership.role === 'owner');
}

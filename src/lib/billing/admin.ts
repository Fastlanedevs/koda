import type { BillingActor } from '@/lib/billing/internal-types';

function parseAllowlist(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLegacyWorkspaceOwnerAllowed() {
  return process.env.BILLING_ADMIN_ALLOW_WORKSPACE_OWNERS === 'true';
}

export function isBillingAdmin(actor: BillingActor) {
  const allowedUsers = parseAllowlist(process.env.BILLING_ADMIN_USER_IDS);
  if (allowedUsers.includes(actor.user.id)) {
    return true;
  }

  if (!isLegacyWorkspaceOwnerAllowed()) {
    return false;
  }

  return actor.memberships.some((membership) => membership.role === 'owner');
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { isBillingAdmin } from './admin';

const actor = {
  user: { id: 'user_123', email: 'owner@example.com' },
  memberships: [{ workspaceId: 'ws_1', role: 'owner' }],
};

test('isBillingAdmin requires explicit allowlist by default', () => {
  process.env.BILLING_ADMIN_USER_IDS = '';
  delete process.env.BILLING_ADMIN_ALLOW_WORKSPACE_OWNERS;
  assert.equal(isBillingAdmin(actor), false);
});

test('isBillingAdmin allows configured user ids', () => {
  process.env.BILLING_ADMIN_USER_IDS = 'user_123, user_999';
  assert.equal(isBillingAdmin(actor), true);
});

test('isBillingAdmin can allow workspace owners behind explicit legacy flag', () => {
  process.env.BILLING_ADMIN_USER_IDS = '';
  process.env.BILLING_ADMIN_ALLOW_WORKSPACE_OWNERS = 'true';
  assert.equal(isBillingAdmin(actor), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { ingestBillingInvoiceSchema } from './invoice-contract';

test('ingestBillingInvoiceSchema accepts expected invoice payload', () => {
  const parsed = ingestBillingInvoiceSchema.safeParse({
    authority: 'clerk',
    authorityInvoiceId: 'inv_ext_1',
    billingAccountId: 'acct_1',
    invoiceNumber: 'INV-2026-001',
    amountMinor: 1900,
    currency: 'usd',
    status: 'paid',
    invoiceDate: new Date().toISOString(),
    payload: { source: 'test' },
  });

  assert.equal(parsed.success, true);
});

test('ingestBillingInvoiceSchema rejects missing required fields', () => {
  const parsed = ingestBillingInvoiceSchema.safeParse({
    authority: 'clerk',
    billingAccountId: 'acct_1',
  });

  assert.equal(parsed.success, false);
});

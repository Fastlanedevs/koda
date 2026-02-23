import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { ingestBillingInvoiceSchema, type IngestBillingInvoiceInput } from '@/lib/billing/invoice-contract';
import { getDatabaseAsync } from '@/lib/db';
import { billingInvoices } from '@/lib/db/schema';

export async function ingestBillingInvoice(input: IngestBillingInvoiceInput) {
  const db = await getDatabaseAsync();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(billingInvoices)
    .where(
      and(
        eq(billingInvoices.authority, input.authority),
        eq(billingInvoices.authorityInvoiceId, input.authorityInvoiceId)
      )
    )
    .limit(1);

  const createdId = existing?.id ?? randomUUID();

  await db
    .insert(billingInvoices)
    .values({
      id: createdId,
      authority: input.authority,
      authorityInvoiceId: input.authorityInvoiceId,
      billingAccountId: input.billingAccountId,
      invoiceNumber: input.invoiceNumber,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      status: input.status,
      invoiceDate: new Date(input.invoiceDate),
      receiptUrl: input.receiptUrl ?? null,
      payloadJson: JSON.stringify(input.payload ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [billingInvoices.authority, billingInvoices.authorityInvoiceId],
      set: {
        billingAccountId: input.billingAccountId,
        invoiceNumber: input.invoiceNumber,
        amountMinor: input.amountMinor,
        currency: input.currency.toUpperCase(),
        status: input.status,
        invoiceDate: new Date(input.invoiceDate),
        receiptUrl: input.receiptUrl ?? null,
        payloadJson: JSON.stringify(input.payload ?? {}),
        updatedAt: now,
      },
    });

  const [row] = await db.select().from(billingInvoices).where(eq(billingInvoices.id, createdId)).limit(1);
  if (!row) {
    throw new Error('Failed to persist invoice');
  }

  return row;
}

export async function listBillingInvoicesForAccount(billingAccountId: string, limit = 50) {
  const db = await getDatabaseAsync();
  return db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.billingAccountId, billingAccountId))
    .orderBy(desc(billingInvoices.invoiceDate))
    .limit(Math.max(1, Math.min(limit, 200)));
}

export { ingestBillingInvoiceSchema };

import { z } from 'zod';

export const invoiceStatusSchema = z.enum(['paid', 'open', 'failed', 'refunded']);

export const ingestBillingInvoiceSchema = z
  .object({
    authority: z.string().min(1),
    authorityInvoiceId: z.string().min(1),
    billingAccountId: z.string().min(1),
    invoiceNumber: z.string().min(1),
    amountMinor: z.number().int(),
    currency: z.string().min(3).max(8),
    status: invoiceStatusSchema,
    invoiceDate: z.string().datetime(),
    receiptUrl: z.string().url().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type IngestBillingInvoiceInput = z.infer<typeof ingestBillingInvoiceSchema>;

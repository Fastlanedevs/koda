export type BillingPlanCode = 'free' | 'starter' | 'pro' | 'team';

export type BillingStatus =
  | 'trialing'
  | 'active'
  | 'grace'
  | 'payment_failed'
  | 'canceled'
  | 'expired';

export interface BillingUsageSummary {
  key: 'credits' | 'storage' | 'seats';
  label: string;
  used: number;
  limit: number;
  unit: string;
}

export interface BillingOverviewResponse {
  workspaceId: string;
  workspaceName: string;
  role: string;
  isOwner: boolean;
  ownerNotice?: string;
  plan: {
    code: BillingPlanCode;
    name: string;
    interval: 'month' | 'year';
    priceLabel: string;
    currency: string;
    renewalDate: string | null;
    status: BillingStatus;
    trialEndsAt?: string | null;
    canceledAt?: string | null;
  };
  usage: BillingUsageSummary[];
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    email: string;
  } | null;
}

export interface BillingInvoiceRow {
  id: string;
  number: string;
  amountMinor: number;
  currency: string;
  status: 'paid' | 'open' | 'failed' | 'refunded';
  invoiceDate: string;
  receiptUrl?: string;
}

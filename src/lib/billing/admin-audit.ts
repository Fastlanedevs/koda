import 'server-only';

import { randomUUID } from 'crypto';
import { getDatabaseAsync } from '@/lib/db';
import { billingAdminAuditLogs } from '@/lib/db/schema';

export async function logBillingAdminAction(params: {
  actorUserId: string;
  action: 'manual_credit_adjustment' | 'reconciliation_trigger' | 'invoice_ingest';
  workspaceId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDatabaseAsync();
  await db.insert(billingAdminAuditLogs).values({
    id: randomUUID(),
    actorUserId: params.actorUserId,
    action: params.action,
    workspaceId: params.workspaceId ?? null,
    requestId: params.requestId ?? null,
    metadataJson: JSON.stringify(params.metadata ?? {}),
    createdAt: new Date(),
  });
}

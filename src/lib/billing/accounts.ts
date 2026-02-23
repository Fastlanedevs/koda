import 'server-only';

import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDatabaseAsync } from '@/lib/db';
import { billingAccounts, workspaceMembers } from '@/lib/db/schema';

export async function ensureBillingAccountForWorkspace(workspaceId: string) {
  const db = await getDatabaseAsync();

  const [existing] = await db
    .select()
    .from(billingAccounts)
    .where(and(eq(billingAccounts.ownerType, 'workspace'), eq(billingAccounts.ownerId, workspaceId)))
    .limit(1);

  if (existing) {
    return existing;
  }

  const now = new Date();
  const insert = {
    id: randomUUID(),
    ownerType: 'workspace',
    ownerId: workspaceId,
    clerkCustomerId: null,
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
  } as const;

  await db.insert(billingAccounts).values(insert);

  const [created] = await db.select().from(billingAccounts).where(eq(billingAccounts.id, insert.id)).limit(1);
  if (!created) {
    throw new Error('Failed to create billing account');
  }
  return created;
}

export async function resolveBillingAccountForWorkspaceMember(params: {
  workspaceId: string;
  userId: string;
}) {
  const db = await getDatabaseAsync();
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, params.workspaceId),
        eq(workspaceMembers.userId, params.userId)
      )
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  const account = await ensureBillingAccountForWorkspace(params.workspaceId);

  return {
    account,
    role: membership.role,
  };
}

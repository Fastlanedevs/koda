import 'server-only';

import { and, eq, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { isBillingAdmin } from '@/lib/billing/admin';
import { getDatabaseAsync } from '@/lib/db';
import { pricingVersions } from '@/lib/db/schema';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const db = await getDatabaseAsync();
  const now = new Date();

  await db.transaction(async (tx: any) => {
    await tx
      .update(pricingVersions)
      .set({ status: 'retired', effectiveTo: now })
      .where(and(eq(pricingVersions.status, 'active'), ne(pricingVersions.id, id)));

    await tx
      .update(pricingVersions)
      .set({ status: 'active', effectiveFrom: now, effectiveTo: null })
      .where(eq(pricingVersions.id, id));
  });

  return NextResponse.json({ ok: true, activeVersionId: id });
}

import 'server-only';

import { randomUUID } from 'crypto';
import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { isBillingAdmin } from '@/lib/billing/admin';
import { ensureDefaultPricingSeed } from '@/lib/billing/pricing';
import { getDatabaseAsync } from '@/lib/db';
import { costRules, pricingVersions } from '@/lib/db/schema';

export async function GET() {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await ensureDefaultPricingSeed();
  const db = await getDatabaseAsync();

  const versions = await db.select().from(pricingVersions).orderBy(desc(pricingVersions.effectiveFrom));

  return NextResponse.json({ versions });
}

export async function POST(request: Request) {
  const actorResult = await requireActor();
  if (!actorResult.ok) return actorResult.response;

  if (!isBillingAdmin(actorResult.actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json()) as {
    versionCode?: string;
    rules?: Array<{ provider: string; operationType: string; modelRef: string; ruleJson: Record<string, unknown> }>;
  };

  if (!body.versionCode || !body.rules || body.rules.length === 0) {
    return NextResponse.json(
      { error: 'versionCode and rules[] are required' },
      { status: 400 }
    );
  }

  const now = new Date();
  const versionId = randomUUID();
  const db = await getDatabaseAsync();

  await db.transaction(async (tx: any) => {
    await tx.insert(pricingVersions).values({
      id: versionId,
      versionCode: body.versionCode,
      status: 'draft',
      effectiveFrom: now,
      effectiveTo: null,
      createdAt: now,
    });

    for (const rule of body.rules ?? []) {
      await tx.insert(costRules).values({
        id: randomUUID(),
        pricingVersionId: versionId,
        provider: rule.provider,
        operationType: rule.operationType,
        modelRef: rule.modelRef,
        ruleJson: JSON.stringify(rule.ruleJson ?? {}),
        createdAt: now,
      });
    }
  });

  return NextResponse.json({ ok: true, id: versionId });
}

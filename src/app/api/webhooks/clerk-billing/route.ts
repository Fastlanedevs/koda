/**
 * Clerk Billing Webhook
 *
 * Handles subscription lifecycle events from Clerk Billing:
 * - subscription.created → provision credits for new plan
 * - subscription.updated → adjust credits on plan change
 * - subscription.cancelled → no action (credits remain until period end)
 *
 * Verify webhook signature via Svix (same pattern as Clerk user webhooks).
 */

import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { eq } from 'drizzle-orm';
import { getDatabaseAsync } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getOrCreateBalance, resetMonthlyCredits } from '@/lib/db/credit-queries';
import { getPlanCredits } from '@/lib/credits/costs';

const WEBHOOK_SECRET = process.env.CLERK_BILLING_WEBHOOK_SECRET;

interface BillingEvent {
  type: string;
  data: {
    id: string;
    user_id: string; // Clerk user ID
    plan_id: string; // e.g. 'pro_user'
    status: string;
  };
}

export async function POST(request: Request) {
  if (!WEBHOOK_SECRET) {
    console.error('[clerk-billing] CLERK_BILLING_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // Verify Svix signature
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const body = await request.text();
  let event: BillingEvent;

  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as BillingEvent;
  } catch (err) {
    console.error('[clerk-billing] Webhook verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  console.log(`[clerk-billing] Event: ${event.type}`, event.data);

  // Resolve our internal userId from Clerk's user_id
  const db = await getDatabaseAsync();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, event.data.user_id))
    .limit(1);

  if (!user) {
    console.warn(`[clerk-billing] User not found for clerk_user_id: ${event.data.user_id}`);
    return NextResponse.json({ received: true });
  }

  const planKey = event.data.plan_id || 'free_user';
  const monthlyCredits = getPlanCredits(planKey);

  switch (event.type) {
    case 'subscription.created': {
      // New subscription — provision credits
      await getOrCreateBalance(user.id, planKey);
      console.log(`[clerk-billing] Provisioned ${monthlyCredits} credits for ${user.id} (${planKey})`);
      break;
    }

    case 'subscription.updated': {
      // Plan change — reset to new plan's credit amount
      await resetMonthlyCredits(user.id, monthlyCredits);
      console.log(`[clerk-billing] Reset credits to ${monthlyCredits} for ${user.id} (${planKey})`);
      break;
    }

    case 'subscription.renewed': {
      // Monthly renewal — reset credits (no rollover)
      await resetMonthlyCredits(user.id, monthlyCredits);
      console.log(`[clerk-billing] Monthly reset to ${monthlyCredits} for ${user.id} (${planKey})`);
      break;
    }

    case 'subscription.cancelled': {
      // Credits remain until the end of the billing period
      console.log(`[clerk-billing] Subscription cancelled for ${user.id} — credits remain until period end`);
      break;
    }

    default:
      console.log(`[clerk-billing] Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}

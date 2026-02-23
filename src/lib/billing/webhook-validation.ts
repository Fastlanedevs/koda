import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';

const BILLING_WEBHOOK_DEFAULT_REPLAY_WINDOW_SECONDS = 300;

const subscriptionPayloadSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z
      .object({
        billingAccountId: z.string().min(1),
        subscriptionId: z.string().min(1),
        planCode: z.string().min(1),
        status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'expired']).optional(),
        currentPeriodStart: z.string().datetime().optional(),
        currentPeriodEnd: z.string().datetime().optional(),
        cancelAtPeriodEnd: z.boolean().optional(),
        cycleStart: z.string().datetime().optional(),
        cycleEnd: z.string().datetime().optional(),
        grantCredits: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export type BillingSubscriptionWebhookPayload = z.infer<typeof subscriptionPayloadSchema>;

function parseSignatureHeader(signatureHeader: string | null) {
  if (!signatureHeader) return null;

  const parts = signatureHeader.split(',').map((part) => part.trim());
  const tsPart = parts.find((part) => part.startsWith('t='));
  const v1Part = parts.find((part) => part.startsWith('v1='));
  if (!tsPart || !v1Part) return null;

  const timestamp = Number.parseInt(tsPart.slice(2), 10);
  const signature = v1Part.slice(3);
  if (!Number.isFinite(timestamp) || !signature) return null;

  return { timestamp, signature };
}

function getReplayWindowSeconds() {
  const raw = process.env.BILLING_WEBHOOK_REPLAY_WINDOW_SECONDS;
  if (!raw) return BILLING_WEBHOOK_DEFAULT_REPLAY_WINDOW_SECONDS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return BILLING_WEBHOOK_DEFAULT_REPLAY_WINDOW_SECONDS;
  }

  return parsed;
}

function verifySignedPayload(input: { payload: string; timestamp: number; receivedSignatureHex: string; secret: string }) {
  const signedPayload = `${input.timestamp}.${input.payload}`;
  const digest = createHmac('sha256', input.secret).update(signedPayload).digest('hex');

  const expected = Buffer.from(digest, 'hex');
  const received = Buffer.from(input.receivedSignatureHex, 'hex');

  if (expected.length === 0 || expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

export function validateBillingWebhookRequest(input: {
  payload: string;
  signatureHeader: string | null;
  nowEpochSeconds?: number;
}) {
  const secret = process.env.BILLING_WEBHOOK_SIGNING_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProduction) {
      return { ok: false as const, status: 500, error: 'Missing BILLING_WEBHOOK_SIGNING_SECRET' };
    }

    return { ok: true as const };
  }

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) {
    return { ok: false as const, status: 401, error: 'Invalid signature header format' };
  }

  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const replayWindow = getReplayWindowSeconds();
  if (Math.abs(now - parsed.timestamp) > replayWindow) {
    return { ok: false as const, status: 401, error: 'Webhook signature timestamp outside replay window' };
  }

  const verified = verifySignedPayload({
    payload: input.payload,
    timestamp: parsed.timestamp,
    receivedSignatureHex: parsed.signature,
    secret,
  });

  if (!verified) {
    return { ok: false as const, status: 401, error: 'Invalid signature' };
  }

  return { ok: true as const };
}

export function parseBillingSubscriptionWebhookPayload(payload: string) {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { ok: false as const, status: 400, error: 'Invalid JSON payload' };
  }

  const parsed = subscriptionPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: 'Malformed webhook payload',
      details: parsed.error.flatten(),
    };
  }

  return { ok: true as const, payload: parsed.data };
}

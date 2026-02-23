import 'server-only';

export type BillingMetricEvent = {
  event: string;
  level?: 'info' | 'warn' | 'error';
  workspaceId?: string;
  billingAccountId?: string;
  actorUserId?: string;
  metadata?: Record<string, unknown>;
};

export function emitBillingMetric(input: BillingMetricEvent) {
  const payload = {
    ...input,
    level: input.level ?? 'info',
    ts: new Date().toISOString(),
  };

  const line = `[billing-metric] ${JSON.stringify(payload)}`;
  if (payload.level === 'error') {
    console.error(line);
    return;
  }
  if (payload.level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

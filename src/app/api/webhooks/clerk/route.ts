import 'server-only';

import { handleClerkWebhookIngress } from '@/lib/webhooks/clerk-ingress';

export async function POST(request: Request) {
  return handleClerkWebhookIngress(request);
}

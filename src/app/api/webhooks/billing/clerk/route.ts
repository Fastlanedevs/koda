import 'server-only';

import { handleClerkWebhookIngress } from '@/lib/webhooks/clerk-ingress';

export async function POST(request: Request) {
  const response = await handleClerkWebhookIngress(request, {
    allowAuth: false,
    allowBilling: true,
  });

  response.headers.set('x-webhook-endpoint-deprecated', 'true');
  response.headers.set('x-webhook-endpoint-preferred', '/api/webhooks/clerk');

  return response;
}

import 'server-only';

import type { ReturnTypeRequireActor } from '@/lib/billing/internal-types';

export function resolveActorWorkspace(
  actor: ReturnTypeRequireActor,
  preferredWorkspaceId?: string | null
) {
  if (preferredWorkspaceId) {
    const match = actor.memberships.find(
      (membership: { workspaceId: string }) => membership.workspaceId === preferredWorkspaceId
    );
    if (match) return match;
  }

  return actor.memberships.find((membership: { role: string }) => membership.role === 'owner') ?? actor.memberships[0] ?? null;
}

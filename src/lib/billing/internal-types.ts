export interface BillingActor {
  user: { id: string; email: string };
  memberships: Array<{ workspaceId: string; role: string }>;
}

export type ReturnTypeRequireActor = BillingActor;

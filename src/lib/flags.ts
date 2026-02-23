import { isRuntimeFeatureEnabled } from '@/lib/distribution/capabilities';

export function isAuthV1Enabled() {
  return isRuntimeFeatureEnabled('authV1', 'AUTH_V1');
}

export function isWorkspacesV1Enabled() {
  return isRuntimeFeatureEnabled('workspacesV1', 'WORKSPACES_V1');
}

export function isCollabSharingV1Enabled() {
  return isRuntimeFeatureEnabled('collabSharingV1', 'COLLAB_SHARING_V1');
}

export type CreditsEnforcementMode = 'off' | 'shadow' | 'soft' | 'hard';

export function isBillingEnabled() {
  return process.env.BILLING_ENABLED !== 'false';
}

export function isCreditsMeteringEnabled() {
  return process.env.CREDITS_METERING_ENABLED !== 'false';
}

export function getCreditsEnforcementMode(): CreditsEnforcementMode {
  const mode = process.env.CREDITS_ENFORCEMENT_MODE;
  if (mode === 'off' || mode === 'shadow' || mode === 'soft' || mode === 'hard') {
    return mode;
  }
  return 'shadow';
}

export function isBillingEnforcementActive() {
  const mode = getCreditsEnforcementMode();
  return mode === 'soft' || mode === 'hard';
}

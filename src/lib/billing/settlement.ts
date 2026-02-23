export function computeSettlement(reservedCredits: number, actualCredits: number) {
  const reserved = Math.max(0, Math.trunc(reservedCredits));
  const actual = Math.max(0, Math.trunc(actualCredits));
  const release = Math.max(0, reserved - actual);
  const capture = Math.min(actual, reserved);
  const overflow = Math.max(0, actual - reserved);

  return { reserved, actual, capture, release, overflow };
}

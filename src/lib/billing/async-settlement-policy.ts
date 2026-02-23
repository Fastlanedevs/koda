export function toAsyncSettlementStatus(outcome: 'success' | 'failed' | 'timed_out') {
  if (outcome === 'success') return 'settled';
  if (outcome === 'timed_out') return 'timed_out';
  return 'released';
}

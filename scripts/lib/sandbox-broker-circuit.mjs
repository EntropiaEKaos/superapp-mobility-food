/**
 * Local fail-fast circuit state for the standalone sandbox broker worker.
 * Prevents infinite attempts while a broker repeatedly rejects publications.
 * The durable outbox preserves unprocessed data for a supervisor restart.
 */
export const MAX_CONSECUTIVE_PUBLISH_FAILURES = 3;

export function nextBrokerCircuit(previousFailures, published) {
  if (!Number.isSafeInteger(previousFailures) || previousFailures < 0) {
    throw new RangeError('previousFailures must be non-negative integer');
  }
  if (typeof published !== 'boolean') throw new TypeError('published must be boolean');
  const consecutiveFailures = published ? 0 : previousFailures + 1;
  return {
    consecutiveFailures,
    open: consecutiveFailures >= MAX_CONSECUTIVE_PUBLISH_FAILURES,
  };
}

/**
 * Helpers for interpreting the active comment backend label.
 *
 * The label comes from the active comment store and is either the GitHub
 * store's `GitHub (synced)` or the local fallback `Local (this device)`, used
 * when GitHub can't be reached.
 */

/** True when comments are persisted to GitHub rather than only on this device. */
export function isSyncedBackend(label: string): boolean {
  return label.toLowerCase().includes('github');
}

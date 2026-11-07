/** A device receipt authorizes only a status lookup. It carries no data key or deletion authority. */
export function accountDeletionRecoveryTokenValid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

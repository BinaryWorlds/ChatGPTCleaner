export type LockResult<T> =
  | { readonly kind: "acquired"; readonly value: T }
  | { readonly kind: "unavailable" };

export interface DestructiveRunLock {
  runExclusive<T>(work: () => Promise<T>): Promise<LockResult<T>>;
}

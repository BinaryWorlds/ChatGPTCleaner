export const MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH = 512;

export function isSafetyCriticalIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_SAFETY_CRITICAL_IDENTIFIER_LENGTH
  );
}

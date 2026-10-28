export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function threadId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }

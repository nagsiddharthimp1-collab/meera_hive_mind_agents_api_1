// Older/imported rows may lack a timestamp. Keep them renderable with a stable
// fallback rather than allowing history sorting to throw on null.
export function normalizeMessageTimestamp(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : '1970-01-01T00:00:00.000Z';
}

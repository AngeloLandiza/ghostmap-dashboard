/**
 * Readers for payloads whose exact shape is still settling.
 *
 * The zod schemas in `lib/api/types.ts` normalize casing and fill in defaults, but when a
 * response does not match at all the client deliberately returns the raw payload rather
 * than blanking the page (see `request()`), and a couple of admin shapes are genuinely
 * ambiguous in the contract — `/admin/overview` may put its counts at the top level or
 * under `overview`. These helpers read either form without throwing.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** First key that holds a finite number (accepts numeric strings from Postgres bigints). */
export function pickNumber(source: unknown, keys: readonly string[], fallback = 0): number {
  const record = asRecord(source)
  for (const key of keys) {
    const raw = record[key]
    if (raw === null || raw === undefined || raw === '') continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function pickString(source: unknown, keys: readonly string[], fallback = ''): string {
  const record = asRecord(source)
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'string' && raw) return raw
  }
  return fallback
}

/** First key that holds an array; `[]` when none does. */
export function pickArray(source: unknown, keys: readonly string[]): unknown[] {
  const record = asRecord(source)
  for (const key of keys) {
    const raw = record[key]
    if (Array.isArray(raw)) return raw
  }
  return []
}

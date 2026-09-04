/** Small formatting helpers shared by every page. Pure functions, safe with missing data. */

const NBSP = ' '

/** 1536 -> "1.5 KB". Uses decimal units, like GCS and the billing pages. */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  const n = Number(bytes ?? 0)
  if (!Number.isFinite(n) || n <= 0) return `0${NBSP}B`
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3))
  const value = n / 1000 ** i
  return `${value.toFixed(i === 0 ? 0 : digits)}${NBSP}${units[i]}`
}

/** 3725 -> "1h 2m". Seconds in, human duration out. */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds ?? 0)))
  if (!Number.isFinite(s) || s === 0) return `0${NBSP}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${rest}s`
  return `${rest}s`
}

/** 1234567 -> "1,234,567" (or "1.2M" when `compact`). */
export function formatNumber(value: number | null | undefined, compact = false): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('en-US', compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}).format(n)
}

/** Money with enough precision for free-tier amounts: "$0.0043", "$12.40". */
export function formatUsd(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '$0.00'
  const digits = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n)
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0%'
  return `${n.toFixed(digits)}%`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "3 min ago", "in 2 days". */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = ms - now
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [1000, 'second'],
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
    [604_800_000, 'week'],
    [2_592_000_000, 'month'],
    [31_536_000_000, 'year'],
  ]
  let unit: Intl.RelativeTimeFormatUnit = 'second'
  let divisor = 1000
  for (const [ms_, u] of steps) {
    if (abs >= ms_) {
      divisor = ms_
      unit = u
    }
  }
  return rtf.format(Math.round(diff / divisor), unit)
}

/** Invite codes are 8 uppercase base32 characters; display them as "ABCD-EFGH". */
export function formatInviteCode(code: string | null | undefined): string {
  const c = (code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (c.length !== 8) return c
  return `${c.slice(0, 4)}-${c.slice(4)}`
}

/** Strips the formatting above back to a plain code for URLs and API calls. */
export function normalizeInviteCode(code: string | null | undefined): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '').slice(0, 8)
}

/** Deterministic fallback color when the backend has not assigned one yet. */
export function colorForKey(key: string, palette: readonly string[]): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return palette[hash % palette.length] ?? palette[0] ?? '#38bdf8'
}

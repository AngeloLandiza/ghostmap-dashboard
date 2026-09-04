/**
 * Free-tier gauges (PLAN section 3 `free_tier`): how much of each provider's always-free
 * allowance the measured usage has eaten, which metric runs out first, and how many days
 * are left at the current rate.
 *
 * The backend computes `free_tier` per provider, but the block is optional while the cost
 * module is being built, so the gauge falls back to deriving the worst metric from the
 * `items` it does have.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ProviderCost } from '../../lib/api/types'
import { formatNumber, formatPercent } from '../../lib/format'

export interface GaugeStatus {
  usedPctMax: number
  firstExhaustedMetric: string | null
  daysUntilPaidAtCurrentRate: number | null
}

/** The backend's `free_tier` block, or the worst `quantity / free_quota` ratio in `items`. */
export function freeTierStatus(provider: ProviderCost): GaugeStatus | null {
  const reported = provider.freeTier
  if (reported && Number.isFinite(reported.usedPctMax)) {
    return {
      usedPctMax: reported.usedPctMax,
      firstExhaustedMetric: reported.firstExhaustedMetric ?? null,
      daysUntilPaidAtCurrentRate: reported.daysUntilPaidAtCurrentRate ?? null,
    }
  }

  let worst: GaugeStatus | null = null
  for (const item of provider.items) {
    if (!Number.isFinite(item.freeQuota) || item.freeQuota <= 0) continue
    const pct = (item.quantity / item.freeQuota) * 100
    if (!Number.isFinite(pct)) continue
    if (!worst || pct > worst.usedPctMax) {
      worst = { usedPctMax: pct, firstExhaustedMetric: item.metric, daysUntilPaidAtCurrentRate: null }
    }
  }
  return worst
}

export type MeterTone = 'good' | 'warn' | 'bad'

export function toneForPct(pct: number): MeterTone {
  if (pct >= 90) return 'bad'
  if (pct >= 60) return 'warn'
  return 'good'
}

const BAR_TONES: Record<MeterTone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
}

const TEXT_TONES: Record<MeterTone, string> = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-300',
}

/** A single progress bar, clamped to 0-100 % but keeping the real number in the label. */
export function MeterBar({
  pct,
  tone,
  className = '',
}: {
  pct: number
  tone?: MeterTone
  className?: string
}): JSX.Element {
  const safe = Number.isFinite(pct) ? Math.max(0, pct) : 0
  const width = Math.min(100, safe)
  const resolved = tone ?? toneForPct(safe)
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-ink-800 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${BAR_TONES[resolved]}`} style={{ width: `${width}%` }} />
    </div>
  )
}

/** Generic "x of y used" meter, for quotas the pages measure themselves (bucket bytes...). */
export function QuotaMeter({
  label,
  used,
  quota,
  unit,
  hint,
}: {
  label: ReactNode
  used: number
  quota: number
  unit?: string
  hint?: ReactNode
}): JSX.Element {
  const pct = quota > 0 ? (used / quota) * 100 : 0
  const tone = toneForPct(pct)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink-200">{label}</span>
        <span className={`text-xs tabular-nums ${TEXT_TONES[tone]}`}>{formatPercent(pct, pct < 10 ? 1 : 0)}</span>
      </div>
      <MeterBar pct={pct} tone={tone} />
      <p className="text-xs text-ink-500">
        {formatNumber(used, true)} of {formatNumber(quota, true)}
        {unit ? ` ${unit}` : ''} free {hint ? <span className="text-ink-600"> · {hint}</span> : null}
      </p>
    </div>
  )
}

/** One provider's free-tier gauge. */
export function FreeTierGauge({ provider }: { provider: ProviderCost }): JSX.Element {
  const status = freeTierStatus(provider)
  const pct = status?.usedPctMax ?? 0
  const tone = toneForPct(pct)

  // `days_until_paid_at_current_rate` is null when nothing is projected to become billable,
  // but the shared schema coerces that null to 0 — which would read as "already billable".
  // Only the used percentage can say that, so a non-positive countdown is treated as absent.
  const rawDays = status?.daysUntilPaidAtCurrentRate
  const alreadyBillable = pct >= 100
  const daysLeft = typeof rawDays === 'number' && Number.isFinite(rawDays) && rawDays > 0 ? rawDays : null

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-ink-800/70 bg-ink-950/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink-100" title={provider.provider}>
          {provider.provider}
        </span>
        <span className={`shrink-0 text-xs tabular-nums ${TEXT_TONES[tone]}`}>
          {status ? formatPercent(pct, pct > 0 && pct < 10 ? 1 : 0) : 'n/a'}
        </span>
      </div>

      <MeterBar pct={pct} tone={tone} />

      <p className="text-xs text-ink-500">
        {status?.firstExhaustedMetric ? (
          <>
            first to exhaust: <span className="text-ink-300">{status.firstExhaustedMetric}</span>
          </>
        ) : (
          'no metered free quota'
        )}
      </p>

      <p className="flex items-center gap-1 text-xs">
        {alreadyBillable || daysLeft !== null ? (
          <>
            <AlertTriangle className={`h-3 w-3 ${TEXT_TONES[tone]}`} aria-hidden />
            <span className={TEXT_TONES[tone]}>
              {alreadyBillable
                ? 'over the free quota · already billable'
                : `~${formatNumber(Math.round(daysLeft ?? 0))} days until paid`}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-hidden />
            <span className="text-ink-500">inside the free tier at the current rate</span>
          </>
        )}
      </p>
    </div>
  )
}

/** Grid of gauges, one per provider in a `CostReport`. */
export function FreeTierGauges({ providers }: { providers: ProviderCost[] }): JSX.Element {
  if (providers.length === 0) {
    return <p className="py-4 text-center text-sm text-ink-500">No providers in the report yet.</p>
  }
  const ordered = [...providers].sort((a, b) => (freeTierStatus(b)?.usedPctMax ?? 0) - (freeTierStatus(a)?.usedPctMax ?? 0))
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ordered.map((provider) => (
        <FreeTierGauge key={provider.provider} provider={provider} />
      ))}
    </div>
  )
}

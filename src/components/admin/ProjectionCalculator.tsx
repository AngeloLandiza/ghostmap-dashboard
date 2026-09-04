/**
 * "What would this cost at scale?" — every parameter of `project()` (PLAN section 3) as a
 * slider plus a number box, debounced into `GET /admin/costs/projection`.
 *
 * The report that comes back is the same `CostReport` shape as the measured overview, so
 * the monthly totals, free-tier gauges and the priced-metric table are the same components.
 */
import { useMemo, useRef, useState } from 'react'
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { RotateCcw } from 'lucide-react'
import { DEFAULT_PROJECTION_PARAMS, type CostReport, type ProjectionParams } from '../../lib/api/types'
import { useCostProjection } from '../../lib/api/hooks'
import { formatBytes, formatNumber, formatUsd } from '../../lib/format'
import { StatTile } from '../ui'
import { Panel, QueryState } from './AdminUi'
import { CostMetricsTable } from './CostTables'
import { FreeTierGauges } from './FreeTierGauge'
import { AXIS_PROPS, CHART_COLORS, ChartFrame, SERIES_PROPS, TOOLTIP_PROPS, usdTick } from './charts'
import { useDebounced } from './useDebounced'

type ParamKey = keyof typeof DEFAULT_PROJECTION_PARAMS

interface ParamSpec {
  key: ParamKey
  label: string
  min: number
  max: number
  step: number
  /** Short unit shown after the number box. */
  unit?: string
  hint?: string
  /** Formats the value for the hint line (bytes, mostly). */
  format?: (value: number) => string
}

/** Every parameter of PLAN section 3's `project(params)`, in the order it lists them. */
const PARAM_SPECS: ParamSpec[] = [
  { key: 'mappers', label: 'Mappers (phones)', min: 1, max: 200, step: 1, hint: 'Devices capturing keyframes.' },
  { key: 'sessions_per_day', label: 'Sessions per day', min: 0, max: 200, step: 1, unit: '/day' },
  { key: 'minutes_per_session', label: 'Minutes per session', min: 1, max: 120, step: 1, unit: 'min' },
  { key: 'keyframes_per_second', label: 'Keyframes per second', min: 0.5, max: 10, step: 0.5, unit: '/s' },
  {
    key: 'depth_bytes_per_keyframe',
    label: 'Depth bytes per keyframe',
    min: 5_000,
    max: 250_000,
    step: 1_000,
    unit: 'B',
    hint: 'LZFSE depth + confidence payload.',
    format: (value) => formatBytes(value),
  },
  {
    key: 'jpeg_every_n',
    label: 'JPEG every N keyframes',
    min: 0,
    max: 30,
    step: 1,
    hint: '0 uploads no colour frames.',
  },
  { key: 'viewers_per_session', label: 'Viewers per session', min: 0, max: 20, step: 1 },
  { key: 'map_size_mb', label: 'Map size', min: 1, max: 500, step: 1, unit: 'MB' },
  { key: 'maps_per_day', label: 'Maps saved per day', min: 0, max: 100, step: 1, unit: '/day' },
  { key: 'retention_days', label: 'Retention', min: 1, max: 365, step: 1, unit: 'days' },
  { key: 'dashboard_views_per_day', label: 'Dashboard views per day', min: 0, max: 2_000, step: 10, unit: '/day' },
]

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function ParamControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  const id = `projection-${spec.key}`
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-ink-800/70 bg-ink-950/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-ink-200">
          {spec.label}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <input
            id={id}
            type="number"
            className="w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-right text-xs tabular-nums text-ink-100 focus:border-ghost-600"
            value={value}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            onChange={(event) => {
              const next = Number.parseFloat(event.target.value)
              if (Number.isFinite(next)) onChange(clamp(next, spec.min, spec.max))
            }}
          />
          {spec.unit ? <span className="w-8 text-[11px] text-ink-500">{spec.unit}</span> : <span className="w-8" />}
        </div>
      </div>
      <input
        type="range"
        className="w-full accent-ghost-500"
        aria-label={spec.label}
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(event) => onChange(clamp(Number.parseFloat(event.target.value), spec.min, spec.max))}
      />
      {spec.hint || spec.format ? (
        <p className="text-[11px] text-ink-500">
          {spec.format ? `${spec.format(value)}${spec.hint ? ' · ' : ''}` : ''}
          {spec.hint ?? ''}
        </p>
      ) : null}
    </div>
  )
}

export function ProjectionCalculator(): JSX.Element {
  const [params, setParams] = useState<Required<ProjectionParams>>({ ...DEFAULT_PROJECTION_PARAMS })
  const debounced = useDebounced(params, 400)
  const projection = useCostProjection(debounced)

  // Every parameter change is a new query key, so the report would blank out mid-drag.
  // Keeping the last one lets the results stay on screen, dimmed, until the next lands.
  const lastReport = useRef<CostReport | null>(null)
  if (projection.data) lastReport.current = projection.data
  const report = projection.data ?? lastReport.current

  const providerTotals = useMemo(
    () =>
      (report?.providers ?? [])
        .map((provider) => ({ provider: provider.provider, total: provider.totalUsd }))
        .sort((a, b) => b.total - a.total),
    [report],
  )

  const monthly = report?.grandTotalUsd ?? 0
  const runRate = report?.monthlyRunRateUsd ?? monthly
  const isStale = projection.isFetching || params !== debounced

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Projection calculator"
        description="Monthly cost for a hypothetical load, priced with the same table as the measured estimate."
        actions={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setParams({ ...DEFAULT_PROJECTION_PARAMS })}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PARAM_SPECS.map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={params[spec.key]}
              onChange={(value) => setParams((prev) => ({ ...prev, [spec.key]: value }))}
            />
          ))}
        </div>
      </Panel>

      <QueryState
        isPending={projection.isPending && !report}
        isError={projection.isError}
        error={projection.error}
        refetch={projection.refetch}
        loadingLabel="Projecting…"
        notConfigured={{ feature: 'The cost projection endpoint', doc: 'monitoring' }}
      />

      {report ? (
        <div className={`flex flex-col gap-4 transition-opacity ${isStale ? 'opacity-60' : ''}`}>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Projected monthly" value={formatUsd(monthly)} hint="all providers" />
            <StatTile label="Monthly run rate" value={formatUsd(runRate)} hint="as the backend reports it" />
            <StatTile label="Per year" value={formatUsd(monthly * 12)} hint="12 x monthly" />
            <StatTile
              label="Keyframes / month"
              value={formatNumber(
                params.mappers *
                  params.sessions_per_day *
                  params.minutes_per_session *
                  60 *
                  params.keyframes_per_second *
                  30,
                true,
              )}
              hint="from these parameters"
            />
          </section>

          <Panel title="Monthly cost by provider" description="Zero-cost providers stay inside their free tier.">
            {providerTotals.length > 0 ? (
              <ChartFrame height={Math.max(180, providerTotals.length * 34 + 40)}>
                <BarChart data={providerTotals} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <XAxis type="number" {...AXIS_PROPS} tickFormatter={usdTick} />
                  <YAxis type="category" dataKey="provider" width={130} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_PROPS} formatter={(value: number) => [formatUsd(value), 'monthly']} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} {...SERIES_PROPS}>
                    {providerTotals.map((row, index) => (
                      <Cell key={row.provider} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartFrame>
            ) : (
              <p className="py-4 text-center text-sm text-ink-500">The projection returned no providers.</p>
            )}
          </Panel>

          <Panel
            title="Free-tier thresholds at this load"
            description="Where each provider's always-free allowance would stand."
          >
            <FreeTierGauges providers={report.providers} />
          </Panel>

          {report.assumptions.length > 0 ? (
            <Panel title="Assumptions" description="How the backend turned these parameters into quantities.">
              <ul className="flex flex-col gap-1.5">
                {report.assumptions.map((assumption) => (
                  <li key={assumption} className="flex items-start gap-2 text-sm text-ink-300">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ghost-500" aria-hidden />
                    {assumption}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Projected metrics" description="Every quantity the projection prices, per provider.">
            <CostMetricsTable providers={report.providers} emptyLabel="The projection returned no priced metrics." />
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

export default ProjectionCalculator

/**
 * `/admin/costs` — the cost console (PLAN sections 3 and 4).
 *
 * Four tabs, linkable through `?tab=`: measured overview (actual billed spend per day next
 * to the estimate), every priced metric, the projection calculator, and the pricing table
 * with its sources. recharts lives in this lazy chunk.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import { AdminTabs } from '../../components/admin/AdminTabs'
import { Panel, QueryState } from '../../components/admin/AdminUi'
import { CostMetricsTable, PricingTable } from '../../components/admin/CostTables'
import { DataTable, type Column } from '../../components/admin/DataTable'
import { FreeTierGauges } from '../../components/admin/FreeTierGauge'
import { ProjectionCalculator } from '../../components/admin/ProjectionCalculator'
import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartFrame,
  GRID_PROPS,
  LEGEND_PROPS,
  SERIES_PROPS,
  TOOLTIP_PROPS,
  colorForSeries,
  shortDay,
  usdTick,
} from '../../components/admin/charts'
import { PageHeader, StatTile } from '../../components/ui'
import {
  useAdminBillingCosts,
  useCostOverview,
  useCostPricing,
  useCostUsage,
} from '../../lib/api/hooks'
import { formatBytes, formatNumber, formatRelative, formatUsd } from '../../lib/format'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'projection', label: 'Projection' },
  { key: 'pricing', label: 'Pricing' },
] as const

type TabKey = (typeof TABS)[number]['key']

const DAY_WINDOWS = [7, 30, 90] as const

/** Small segmented control used for the tab strip and the day window. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { key: T; label: string }[]
  onChange: (value: T) => void
  label: string
}): JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-ink-700/70 bg-ink-900/60 p-0.5" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.key)}
          type="button"
          role="tab"
          aria-selected={option.key === value}
          className={[
            'rounded-md px-3 py-1.5 text-xs transition-colors',
            option.key === value ? 'bg-ghost-700/30 text-ghost-300' : 'text-ink-400 hover:text-ink-100',
          ].join(' ')}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------- actual cost, stacked */

interface StackedDay {
  day: string
  [service: string]: number | string
}

/** Pivots the billing export rows (day, service, cost) into one record per day. */
function stackByService(rows: { day: string; service: string; costUsd: number }[]): {
  data: StackedDay[]
  services: string[]
} {
  const byDay = new Map<string, StackedDay>()
  const services = new Set<string>()

  for (const row of rows) {
    const day = row.day || 'unknown'
    const service = row.service || 'other'
    services.add(service)
    const entry: StackedDay = byDay.get(day) ?? { day }
    entry[service] = Number(entry[service] ?? 0) + (Number.isFinite(row.costUsd) ? row.costUsd : 0)
    byDay.set(day, entry)
  }

  return {
    data: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    services: [...services].sort(),
  }
}

/* ------------------------------------------------------------------- overview */

function OverviewTab({ days }: { days: number }): JSX.Element {
  const billing = useAdminBillingCosts(days)
  const estimate = useCostOverview(days)

  const stacked = useMemo(() => stackByService(billing.data?.rows ?? []), [billing.data])

  const providerTotals = useMemo(
    () =>
      (estimate.data?.providers ?? [])
        .map((provider) => ({ provider: provider.provider, total: provider.totalUsd }))
        .sort((a, b) => b.total - a.total),
    [estimate.data],
  )

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={`Actual GCP · ${days}d`}
          value={billing.data ? formatUsd(billing.data.totalUsd) : '—'}
          hint={billing.data ? (billing.data.cached ? 'billing export · cached' : 'billing export') : 'not available'}
        />
        <StatTile
          label={`Estimated · ${days}d`}
          value={estimate.data ? formatUsd(estimate.data.grandTotalUsd) : '—'}
          hint="all providers"
        />
        <StatTile
          label="Monthly run rate"
          value={estimate.data ? formatUsd(estimate.data.monthlyRunRateUsd) : '—'}
          hint={estimate.data?.generatedAt ? formatRelative(estimate.data.generatedAt) : undefined}
        />
        <StatTile
          label="Providers"
          value={formatNumber(estimate.data?.providers.length ?? 0)}
          hint={`${formatNumber(stacked.services.length)} GCP services billed`}
        />
      </section>

      <Panel
        title="Actual cost per day"
        description="Billed GCP spend from the BigQuery export, stacked by service."
      >
        <QueryState
          isPending={billing.isPending}
          isError={billing.isError}
          error={billing.error}
          refetch={billing.refetch}
          loadingLabel="Loading the billing export…"
          notConfigured={{ feature: 'The BigQuery billing export', doc: 'monitoring' }}
        />
        {billing.data ? (
          stacked.data.length > 0 ? (
            <ChartFrame height={300}>
              <BarChart data={stacked.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="day" tickFormatter={shortDay} {...AXIS_PROPS} minTickGap={16} />
                <YAxis tickFormatter={usdTick} width={64} {...AXIS_PROPS} />
                <Tooltip
                  {...TOOLTIP_PROPS}
                  labelFormatter={(label: string) => shortDay(label)}
                  formatter={(value: number, name: string) => [formatUsd(value), name]}
                />
                <Legend {...LEGEND_PROPS} />
                {stacked.services.map((service, index) => (
                  <Bar key={service} dataKey={service} stackId="cost" fill={colorForSeries(service, index)} {...SERIES_PROPS} />
                ))}
              </BarChart>
            </ChartFrame>
          ) : (
            <p className="py-6 text-center text-sm text-ink-500">
              The export is configured but has no rows for this window.
            </p>
          )
        ) : null}
      </Panel>

      <Panel
        title="Estimated cost by provider"
        description="Measured usage priced against each provider's published list price."
      >
        <QueryState
          isPending={estimate.isPending}
          isError={estimate.isError}
          error={estimate.error}
          refetch={estimate.refetch}
          loadingLabel="Pricing measured usage…"
          notConfigured={{ feature: 'The cost estimator', doc: 'monitoring' }}
        />
        {estimate.data ? (
          providerTotals.length > 0 ? (
            <ChartFrame height={Math.max(200, providerTotals.length * 34 + 40)}>
              <BarChart data={providerTotals} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <XAxis type="number" tickFormatter={usdTick} {...AXIS_PROPS} />
                <YAxis type="category" dataKey="provider" width={140} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_PROPS} formatter={(value: number) => [formatUsd(value), `${days}d`]} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]} {...SERIES_PROPS}>
                  {providerTotals.map((row, index) => (
                    <Cell key={row.provider} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartFrame>
          ) : (
            <p className="py-6 text-center text-sm text-ink-500">The estimator returned no providers.</p>
          )
        ) : null}
      </Panel>

      <Panel title="Free tiers" description="Used percentage, first metric to exhaust and days until paid.">
        {estimate.data ? (
          <FreeTierGauges providers={estimate.data.providers} />
        ) : (
          <p className="py-4 text-center text-sm text-ink-500">Waiting for the estimate.</p>
        )}
      </Panel>
    </div>
  )
}

/* -------------------------------------------------------------------- metrics */

interface UsageEventRow {
  kind: string
  count: number
  bytes: number
}

function MetricsTab({ days }: { days: number }): JSX.Element {
  const estimate = useCostOverview(days)
  const usage = useCostUsage(days)

  const usageMetrics = useMemo(() => Object.entries(usage.data?.metrics ?? {}).sort(([a], [b]) => a.localeCompare(b)), [
    usage.data,
  ])

  const eventColumns: Column<UsageEventRow>[] = [
    { key: 'kind', header: 'Event', sortValue: (row) => row.kind, render: (row) => row.kind },
    {
      key: 'count',
      header: 'Count',
      align: 'right',
      sortValue: (row) => row.count,
      render: (row) => formatNumber(row.count),
    },
    {
      key: 'bytes',
      header: 'Bytes',
      align: 'right',
      sortValue: (row) => row.bytes,
      render: (row) => formatBytes(row.bytes),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Every priced metric"
        description={`Quantity, free quota, billable amount, unit price and cost over the last ${days} days. Sort by any column.`}
      >
        <QueryState
          isPending={estimate.isPending}
          isError={estimate.isError}
          error={estimate.error}
          refetch={estimate.refetch}
          loadingLabel="Pricing measured usage…"
          notConfigured={{ feature: 'The cost estimator', doc: 'monitoring' }}
        />
        {estimate.data ? <CostMetricsTable providers={estimate.data.providers} /> : null}
      </Panel>

      <Panel
        title="Measured usage"
        description="The raw quantities behind the estimate, straight from api_usage and usage_events."
      >
        <QueryState
          isPending={usage.isPending}
          isError={usage.isError}
          error={usage.error}
          refetch={usage.refetch}
          loadingLabel="Measuring usage…"
          notConfigured={{ feature: 'The usage collector', doc: 'monitoring' }}
        />
        {usage.data ? (
          <div className="flex flex-col gap-4">
            {usageMetrics.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {usageMetrics.map(([key, value]) => (
                  <div key={key} className="flex flex-col border-b border-ink-800/60 py-1.5">
                    <dt className="truncate text-xs text-ink-400" title={key}>
                      {key}
                    </dt>
                    <dd className="text-sm tabular-nums text-ink-100">
                      {/bytes|size/i.test(key) ? formatBytes(value) : formatNumber(value, value >= 10_000)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {usage.data.events.length > 0 ? (
              <DataTable
                caption="Recorded usage events"
                columns={eventColumns}
                rows={usage.data.events as UsageEventRow[]}
                rowKey={(row, index) => `${row.kind}:${index}`}
                initialSort={{ key: 'count', direction: 'desc' }}
              />
            ) : null}
            {usageMetrics.length === 0 && usage.data.events.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-500">No usage recorded in this window.</p>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

/* -------------------------------------------------------------------- pricing */

function PricingTab(): JSX.Element {
  const pricing = useCostPricing()
  const entries = pricing.data?.pricing ?? []
  const unverified = entries.filter((entry) => !entry.verified).length

  return (
    <Panel
      title="Pricing table"
      description="One row per provider metric, with the free quota, the date the price was last checked and a link to the page it came from."
      actions={
        pricing.data?.generatedAt ? (
          <span className="text-xs text-ink-500">generated {formatRelative(pricing.data.generatedAt)}</span>
        ) : null
      }
    >
      <QueryState
        isPending={pricing.isPending}
        isError={pricing.isError}
        error={pricing.error}
        refetch={pricing.refetch}
        loadingLabel="Loading the pricing table…"
        notConfigured={{ feature: 'The pricing table', doc: 'monitoring' }}
      />
      {pricing.data ? (
        <div className="flex flex-col gap-3">
          {unverified > 0 ? (
            <p className="rounded-lg border border-amber-900/40 bg-amber-950/10 px-3 py-2 text-xs text-amber-300">
              {formatNumber(unverified)} of {formatNumber(entries.length)} prices are marked unverified: nobody has
              confirmed them against the provider's pricing page yet, so treat those costs as indicative.
            </p>
          ) : null}
          <PricingTable entries={entries} />
        </div>
      ) : null}
    </Panel>
  )
}

/* ----------------------------------------------------------------------- page */

export function AdminCostsPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()

  const rawTab = searchParams.get('tab') ?? 'overview'
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'overview'

  const rawDays = Number(searchParams.get('days') ?? 30)
  const days = DAY_WINDOWS.includes(rawDays as (typeof DAY_WINDOWS)[number]) ? rawDays : 30

  const update = (next: Partial<{ tab: TabKey; days: number }>): void => {
    const params = new URLSearchParams(searchParams)
    const nextTab = next.tab ?? tab
    const nextDays = next.days ?? days
    if (nextTab === 'overview') params.delete('tab')
    else params.set('tab', nextTab)
    if (nextDays === 30) params.delete('days')
    else params.set('days', String(nextDays))
    setSearchParams(params, { replace: true })
  }

  const showDays = tab === 'overview' || tab === 'metrics'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Costs"
        description="Measured usage priced against every provider's published list price, next to what Google actually billed — and what it would cost at scale."
      />

      <AdminTabs />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Cost console section"
          value={tab}
          options={TABS}
          onChange={(key) => update({ tab: key })}
        />
        {showDays ? (
          <Segmented
            label="Window"
            value={days}
            options={DAY_WINDOWS.map((d) => ({ key: d as number, label: `${d}d` }))}
            onChange={(value) => update({ days: value })}
          />
        ) : null}
      </div>

      {tab === 'overview' ? <OverviewTab days={days} /> : null}
      {tab === 'metrics' ? <MetricsTab days={days} /> : null}
      {tab === 'projection' ? <ProjectionCalculator /> : null}
      {tab === 'pricing' ? <PricingTab /> : null}
    </div>
  )
}

export default AdminCostsPage

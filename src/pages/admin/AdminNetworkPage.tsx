/**
 * `/admin/network` — traffic, latency percentiles and error rates from `GET /admin/network`
 * (PLAN section 4): totals, the per-hour chart, and the by-route, by-region and by-country
 * breakdowns.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { AdminTabs } from '../../components/admin/AdminTabs'
import { Panel, QueryState } from '../../components/admin/AdminUi'
import { DataTable, type Column } from '../../components/admin/DataTable'
import {
  AXIS_PROPS,
  ChartFrame,
  GRID_PROPS,
  LEGEND_PROPS,
  SERIES_PROPS,
  TOOLTIP_PROPS,
  bytesTick,
  numberTick,
  shortHour,
} from '../../components/admin/charts'
import { pickNumber } from '../../components/admin/tolerant'
import { Badge, PageHeader, StatTile } from '../../components/ui'
import { useAdminNetwork } from '../../lib/api/hooks'
import { formatBytes, formatNumber, formatPercent, formatRelative } from '../../lib/format'

const WINDOWS = [
  { key: 1, label: '1h' },
  { key: 24, label: '24h' },
  { key: 168, label: '7d' },
] as const

type RouteRow = { method: string; route: string; requests: number; p95Ms: number; avgMs: number; errors: number; bytesIn: number; bytesOut: number }
type RegionRow = { region: string; requests: number; avgMs: number }
type CountryRow = { country: string; requests: number }

function ms(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
}

export function AdminNetworkPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawHours = Number(searchParams.get('hours') ?? 24)
  const hours = WINDOWS.some((w) => w.key === rawHours) ? rawHours : 24

  const network = useAdminNetwork(hours, { refetchInterval: 60_000 })
  const data = network.data

  // `totals` is normally nested; fall back to the top level if the payload is flat.
  const totals = data?.totals ?? data
  const requests = pickNumber(totals, ['requests'])
  const serverErrors = pickNumber(totals, ['serverErrors', 'server_errors'])
  const clientErrors = pickNumber(totals, ['clientErrors', 'client_errors'])
  const errorRate = requests > 0 ? ((serverErrors + clientErrors) / requests) * 100 : 0

  const perHour = useMemo(
    () =>
      (data?.perHour ?? []).map((point) => ({
        hour: point.hour,
        requests: point.requests,
        bytes: point.bytes,
      })),
    [data],
  )

  const setHours = (next: number): void => {
    const params = new URLSearchParams(searchParams)
    if (next === 24) params.delete('hours')
    else params.set('hours', String(next))
    setSearchParams(params, { replace: true })
  }

  const routeColumns: Column<RouteRow>[] = [
    {
      key: 'route',
      header: 'Route',
      sortValue: (row) => `${row.method} ${row.route}`,
      render: (row) => (
        <span className="font-mono text-xs">
          <span className="text-ghost-400">{row.method}</span> <span className="text-ink-200">{row.route}</span>
        </span>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      align: 'right',
      sortValue: (row) => row.requests,
      render: (row) => formatNumber(row.requests),
    },
    {
      key: 'errors',
      header: 'Errors',
      align: 'right',
      sortValue: (row) => row.errors,
      render: (row) =>
        row.errors > 0 ? <span className="text-red-300">{formatNumber(row.errors)}</span> : <span className="text-ink-600">0</span>,
    },
    { key: 'p95', header: 'p95', align: 'right', sortValue: (row) => row.p95Ms, render: (row) => ms(row.p95Ms) },
    {
      key: 'avg',
      header: 'Avg',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.avgMs,
      render: (row) => ms(row.avgMs),
    },
    {
      key: 'bytesOut',
      header: 'Egress',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.bytesOut,
      render: (row) => formatBytes(row.bytesOut),
    },
    {
      key: 'bytesIn',
      header: 'Ingress',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.bytesIn,
      render: (row) => formatBytes(row.bytesIn),
    },
  ]

  const regionColumns: Column<RegionRow>[] = [
    { key: 'region', header: 'Region', sortValue: (row) => row.region, render: (row) => row.region || 'unknown' },
    {
      key: 'requests',
      header: 'Requests',
      align: 'right',
      sortValue: (row) => row.requests,
      render: (row) => formatNumber(row.requests),
    },
    { key: 'avg', header: 'Avg', align: 'right', sortValue: (row) => row.avgMs, render: (row) => ms(row.avgMs) },
  ]

  const countryColumns: Column<CountryRow>[] = [
    { key: 'country', header: 'Country', sortValue: (row) => row.country, render: (row) => row.country || 'unknown' },
    {
      key: 'requests',
      header: 'Requests',
      align: 'right',
      sortValue: (row) => row.requests,
      render: (row) => formatNumber(row.requests),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Network"
        description="Every request the API served, from the api_usage table it records itself."
        actions={
          <div className="inline-flex rounded-lg border border-ink-700/70 bg-ink-900/60 p-0.5" role="group" aria-label="Window">
            {WINDOWS.map((window) => (
              <button
                key={window.key}
                type="button"
                aria-pressed={window.key === hours}
                className={[
                  'rounded-md px-3 py-1.5 text-xs transition-colors',
                  window.key === hours ? 'bg-ghost-700/30 text-ghost-300' : 'text-ink-400 hover:text-ink-100',
                ].join(' ')}
                onClick={() => setHours(window.key)}
              >
                {window.label}
              </button>
            ))}
          </div>
        }
      />

      <AdminTabs />

      <QueryState
        isPending={network.isPending}
        isError={network.isError}
        error={network.error}
        refetch={network.refetch}
        loadingLabel="Loading traffic…"
        notConfigured={{ feature: 'Request statistics', doc: 'database' }}
      />

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Requests"
              value={formatNumber(requests)}
              hint={data.since ? `since ${formatRelative(data.since)}` : `${hours}h window`}
            />
            <StatTile
              label="Errors"
              value={formatNumber(serverErrors + clientErrors)}
              hint={`${formatNumber(serverErrors)} 5xx · ${formatNumber(clientErrors)} 4xx`}
            />
            <StatTile label="p50" value={ms(pickNumber(totals, ['p50Ms', 'p50_ms']))} />
            <StatTile
              label="p95"
              value={ms(pickNumber(totals, ['p95Ms', 'p95_ms']))}
              hint={`p99 ${ms(pickNumber(totals, ['p99Ms', 'p99_ms']))}`}
            />
            <StatTile label="Egress" value={formatBytes(pickNumber(totals, ['bytesOut', 'bytes_out']))} />
            <StatTile label="Ingress" value={formatBytes(pickNumber(totals, ['bytesIn', 'bytes_in']))} />
          </section>

          <Panel
            title="Traffic per hour"
            description="Requests and bytes served, bucketed by hour."
            actions={
              errorRate > 0 ? (
                <Badge tone={errorRate >= 5 ? 'bad' : 'warn'}>{formatPercent(errorRate, 1)} errors</Badge>
              ) : (
                <Badge tone="good">no errors</Badge>
              )
            }
          >
            {perHour.length > 0 ? (
              <ChartFrame height={280}>
                <ComposedChart data={perHour} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="requestsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="hour" tickFormatter={shortHour} minTickGap={24} {...AXIS_PROPS} />
                  <YAxis yAxisId="left" tickFormatter={numberTick} width={52} {...AXIS_PROPS} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={bytesTick}
                    width={64}
                    {...AXIS_PROPS}
                  />
                  <Tooltip
                    {...TOOLTIP_PROPS}
                    labelFormatter={(label: string) => shortHour(label)}
                    formatter={(value: number, name: string) => [
                      name === 'bytes' ? formatBytes(value) : formatNumber(value),
                      name === 'bytes' ? 'bytes' : 'requests',
                    ]}
                  />
                  <Legend {...LEGEND_PROPS} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="requests"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="url(#requestsFill)"
                    {...SERIES_PROPS}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="bytes"
                    stroke="#f472b6"
                    strokeWidth={2}
                    dot={false}
                    {...SERIES_PROPS}
                  />
                </ComposedChart>
              </ChartFrame>
            ) : (
              <p className="py-6 text-center text-sm text-ink-500">No requests recorded in this window.</p>
            )}
          </Panel>

          <Panel title="By route" description="Where the time and the bytes go.">
            <DataTable
              caption="Requests by route"
              columns={routeColumns}
              rows={(data.byRoute ?? []) as RouteRow[]}
              rowKey={(row, index) => `${row.method}:${row.route}:${index}`}
              empty="No routes recorded in this window."
              initialSort={{ key: 'requests', direction: 'desc' }}
            />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="By region" description="The Vercel region that served the request.">
              <DataTable
                caption="Requests by region"
                columns={regionColumns}
                rows={(data.byRegion ?? []) as RegionRow[]}
                rowKey={(row, index) => `${row.region}:${index}`}
                empty="No regions recorded."
                initialSort={{ key: 'requests', direction: 'desc' }}
              />
            </Panel>
            <Panel title="By country" description="Where the clients are.">
              <DataTable
                caption="Requests by country"
                columns={countryColumns}
                rows={(data.byCountry ?? []) as CountryRow[]}
                rowKey={(row, index) => `${row.country}:${index}`}
                empty="No countries recorded."
                initialSort={{ key: 'requests', direction: 'desc' }}
              />
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default AdminNetworkPage

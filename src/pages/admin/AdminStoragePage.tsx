/**
 * `/admin/storage` — what the GCS bucket holds, in total and per prefix
 * (`GET /admin/storage`, cached ten minutes by the backend).
 *
 * The free-tier gauge reads its quota from the backend's pricing table rather than
 * hardcoding an allowance here, so there is one source of truth for every price.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { AdminTabs } from '../../components/admin/AdminTabs'
import { NotConfiguredCard, Panel, QueryState, isNotConfigured } from '../../components/admin/AdminUi'
import { DataTable, type Column } from '../../components/admin/DataTable'
import { MeterBar, QuotaMeter } from '../../components/admin/FreeTierGauge'
import { AXIS_PROPS, CHART_COLORS, ChartFrame, SERIES_PROPS, TOOLTIP_PROPS, bytesTick } from '../../components/admin/charts'
import { asRecord, pickNumber } from '../../components/admin/tolerant'
import { PageHeader, StatTile } from '../../components/ui'
import { useAdminStorage, useCostOverview, useCostPricing } from '../../lib/api/hooks'
import { formatBytes, formatNumber, formatPercent, formatRelative, formatUsd } from '../../lib/format'

interface PrefixRow {
  prefix: string
  bytes: number
  objects: number
  share: number
}

/** Free storage allowance, in bytes, from the pricing table (GB-month -> bytes). */
function storageFreeQuotaBytes(entries: { provider: string; metric: string; unit: string; freeQuota: number }[]):
  | { bytes: number; label: string }
  | null {
  const entry = entries.find(
    (candidate) =>
      /storage/i.test(candidate.provider) && /storage/i.test(candidate.metric) && candidate.freeQuota > 0,
  )
  if (!entry) return null
  const perGb = /gb|gib/i.test(entry.unit)
  return { bytes: entry.freeQuota * (perGb ? 1e9 : 1), label: `${entry.provider} · ${entry.metric}` }
}

export function AdminStoragePage(): JSX.Element {
  const storage = useAdminStorage()
  const pricing = useCostPricing()
  const estimate = useCostOverview(30)

  const data = storage.data
  const totalBytes = data?.totalBytes ?? 0

  const prefixes = useMemo<PrefixRow[]>(() => {
    const record = asRecord(data?.prefixes)
    const rows = Object.entries(record).map(([prefix, value]) => ({
      prefix,
      bytes: pickNumber(value, ['bytes']),
      objects: pickNumber(value, ['objects']),
      share: 0,
    }))
    const sum = rows.reduce((acc, row) => acc + row.bytes, 0) || totalBytes || 1
    return rows
      .map((row) => ({ ...row, share: (row.bytes / sum) * 100 }))
      .sort((a, b) => b.bytes - a.bytes)
  }, [data, totalBytes])

  const quota = useMemo(() => storageFreeQuotaBytes(pricing.data?.pricing ?? []), [pricing.data])

  /** Monthly estimate for the storage provider, if the cost report names one. */
  const storageCost = useMemo(
    () => (estimate.data?.providers ?? []).find((provider) => /storage/i.test(provider.provider)) ?? null,
    [estimate.data],
  )

  const columns: Column<PrefixRow>[] = [
    {
      key: 'prefix',
      header: 'Prefix',
      sortValue: (row) => row.prefix,
      render: (row) => <span className="font-mono text-xs text-ink-100">{row.prefix || '/'}</span>,
    },
    {
      key: 'bytes',
      header: 'Bytes',
      align: 'right',
      sortValue: (row) => row.bytes,
      render: (row) => formatBytes(row.bytes),
    },
    {
      key: 'objects',
      header: 'Objects',
      align: 'right',
      sortValue: (row) => row.objects,
      render: (row) => formatNumber(row.objects),
    },
    {
      key: 'share',
      header: 'Share',
      sortValue: (row) => row.share,
      cellClassName: 'w-40',
      render: (row) => (
        <div className="flex items-center gap-2">
          <MeterBar pct={row.share} tone="good" className="w-24" />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-400">
            {formatPercent(row.share, row.share < 10 ? 1 : 0)}
          </span>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Storage"
        description="Every object the API has written to Cloud Storage: maps, keyframe blobs and thumbnails."
        actions={
          <button type="button" className="btn-secondary text-xs" onClick={() => void storage.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
        }
      />

      <AdminTabs />

      <QueryState
        isPending={storage.isPending}
        isError={storage.isError}
        error={storage.error}
        refetch={storage.refetch}
        loadingLabel="Measuring the bucket…"
        notConfigured={{ feature: 'Cloud Storage', doc: 'storage' }}
      />

      {data && !data.configured && !isNotConfigured(storage.error) ? (
        <NotConfiguredCard
          feature="Cloud Storage"
          doc="storage"
          message="The backend answered, but no bucket is configured: set GCS_BUCKET and the service-account credentials on the deployment."
        />
      ) : null}

      {data?.configured ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Bucket" value={<span className="text-base">{data.bucket || '—'}</span>} />
            <StatTile label="Stored" value={formatBytes(totalBytes)} hint={`${formatNumber(prefixes.length)} prefixes`} />
            <StatTile label="Objects" value={formatNumber(data.totalObjects)} />
            <StatTile
              label="Measured"
              value={data.updatedAt ? formatRelative(data.updatedAt) : '—'}
              hint={data.cached ? 'from the 10-minute cache' : 'fresh'}
            />
          </section>

          <Panel
            title="Free tier and cost"
            description="Against the always-free storage allowance in the backend's pricing table."
            actions={
              <Link className="btn-secondary text-xs" to="/admin/costs">
                Cost console
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {quota ? (
                <QuotaMeter
                  label="Stored bytes"
                  used={totalBytes / 1e9}
                  quota={quota.bytes / 1e9}
                  unit="GB"
                  hint={quota.label}
                />
              ) : (
                <p className="text-sm text-ink-500">
                  {pricing.isPending
                    ? 'Loading the pricing table…'
                    : 'The pricing table does not publish a free storage quota, so there is nothing to gauge against.'}
                </p>
              )}
              <div className="flex flex-col justify-center gap-1">
                <p className="text-xs uppercase tracking-wide text-ink-400">Estimated monthly storage</p>
                <p className="text-2xl font-semibold tabular-nums text-white">
                  {storageCost ? formatUsd(storageCost.totalUsd) : '—'}
                </p>
                <p className="text-xs text-ink-500">
                  {storageCost
                    ? `${storageCost.provider}, over the last 30 days of measured usage`
                    : 'Available once the cost estimator reports a storage provider.'}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="By prefix" description="Bytes and objects under each top-level prefix of the bucket.">
            <div className="flex flex-col gap-4">
              {prefixes.length > 0 ? (
                <ChartFrame height={Math.max(160, prefixes.length * 32 + 40)}>
                  <BarChart data={prefixes} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <XAxis type="number" tickFormatter={bytesTick} {...AXIS_PROPS} />
                    <YAxis type="category" dataKey="prefix" width={120} {...AXIS_PROPS} />
                    <Tooltip {...TOOLTIP_PROPS} formatter={(value: number) => [formatBytes(value), 'stored']} />
                    <Bar dataKey="bytes" radius={[0, 4, 4, 0]} {...SERIES_PROPS}>
                      {prefixes.map((row, index) => (
                        <Cell key={row.prefix} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartFrame>
              ) : null}
              <DataTable
                caption="Bucket usage by prefix"
                columns={columns}
                rows={prefixes}
                rowKey={(row) => row.prefix}
                empty="The bucket is empty."
                initialSort={{ key: 'bytes', direction: 'desc' }}
              />
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  )
}

export default AdminStoragePage

/**
 * `/admin/storage` — GCS bucket usage from `GET /admin/storage`.
 */
import { ErrorState, LoadingState, PageHeader, PageStub, StatTile } from '../../components/ui'
import { useAdminStorage } from '../../lib/api/hooks'
import { formatBytes, formatNumber, formatRelative } from '../../lib/format'

export function AdminStoragePage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useAdminStorage()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Storage" description="What the bucket holds, per prefix. Cached for ten minutes by the backend." />
      {isPending ? <LoadingState label="Measuring the bucket…" /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {data?.configured ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Bucket" value={data.bucket || '—'} />
          <StatTile label="Bytes" value={formatBytes(data.totalBytes)} />
          <StatTile label="Objects" value={formatNumber(data.totalObjects)} />
          <StatTile label="Measured" value={formatRelative(data.updatedAt)} hint={data.cached ? 'from cache' : 'fresh'} />
        </section>
      ) : null}
      {data && !data.configured ? <p className="text-sm text-ink-400">GCS is not configured on this backend.</p> : null}
      <PageStub
        planRef="PLAN section 4 · storage"
        todos={[
          'Per-prefix table and a bar chart from data.prefixes (maps/, sessions/, ...).',
          'Free-tier gauge against the 5 GB Cloud Storage always-free allowance from useCostPricing().',
          'Estimated monthly storage cost, linked to /admin/costs.',
        ]}
      />
    </div>
  )
}

export default AdminStoragePage

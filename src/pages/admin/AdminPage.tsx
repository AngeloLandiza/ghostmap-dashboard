/**
 * `/admin` — health, free-tier gauges and actual vs estimated cost (PLAN section 4).
 */
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader, PageStub, StatTile } from '../../components/ui'
import { useAdminOverview } from '../../lib/api/hooks'
import { formatBytes, formatNumber } from '../../lib/format'

export function AdminPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useAdminOverview()
  const o = data?.overview

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admin"
        description="Inventory, deep health checks and where the free tiers stand."
        actions={
          <nav className="flex flex-wrap gap-2">
            <Link className="btn-secondary" to="/admin/costs">
              Costs
            </Link>
            <Link className="btn-secondary" to="/admin/network">
              Network
            </Link>
            <Link className="btn-secondary" to="/admin/storage">
              Storage
            </Link>
          </nav>
        }
      />

      {isPending ? <LoadingState label="Loading overview…" /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {o ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Devices" value={formatNumber(o.devices)} />
          <StatTile label="Maps" value={formatNumber(o.maps)} hint={formatBytes(o.mapBytes)} />
          <StatTile label="Parties" value={formatNumber(o.sessions)} hint={`${formatNumber(o.activeSessions)} active`} />
          <StatTile label="Keyframes" value={formatNumber(o.keyframes, true)} />
          <StatTile label="Merges pending" value={formatNumber(o.pendingMerges)} />
          <StatTile label="Region" value={data?.region || '—'} hint={data?.version || undefined} />
        </section>
      ) : null}

      <PageStub
        planRef="PLAN section 4 · admin home"
        todos={[
          'Deep health panel from useAdminHealth(): database, GCP, Ably, New Relic with detail lines.',
          'Free-tier gauges from useCostOverview(): free_tier.used_pct_max per provider, first_exhausted_metric, days_until_paid.',
          'Actual (BigQuery, useAdminBillingCosts) vs estimated (useCostOverview) totals side by side.',
          'Maintenance actions: useDbMigrate() and useNewRelicPush(), each with a confirmation.',
        ]}
      />
    </div>
  )
}

export default AdminPage

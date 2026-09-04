/**
 * `/admin` — deep health, inventory, actual versus estimated spend, free-tier gauges and
 * the two maintenance actions (PLAN section 4).
 */
import { Link } from 'react-router-dom'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { AdminActions } from '../../components/admin/AdminActions'
import { AdminTabs } from '../../components/admin/AdminTabs'
import { NotConfiguredCard, Panel, QueryState, isNotConfigured } from '../../components/admin/AdminUi'
import { FreeTierGauges } from '../../components/admin/FreeTierGauge'
import { HealthPanel } from '../../components/admin/HealthPanel'
import { pickNumber, pickString } from '../../components/admin/tolerant'
import { Badge, PageHeader, StatTile } from '../../components/ui'
import {
  useAdminBillingCosts,
  useAdminHealth,
  useAdminOverview,
  useCostOverview,
} from '../../lib/api/hooks'
import { formatBytes, formatNumber, formatRelative, formatUsd } from '../../lib/format'

const WINDOW_DAYS = 30

export function AdminPage(): JSX.Element {
  const health = useAdminHealth({ refetchInterval: 60_000 })
  const overview = useAdminOverview({ refetchInterval: 60_000 })
  /** Actual GCP spend from the BigQuery billing export; 501 until that export is wired up. */
  const billing = useAdminBillingCosts(WINDOW_DAYS)
  /** Measured usage priced against every provider's list price. */
  const estimate = useCostOverview(WINDOW_DAYS)

  // `/admin/overview` may report its counts at the top level or under `overview`.
  const counts = overview.data?.overview ?? overview.data
  const region = pickString(overview.data, ['region']) || pickString(health.data, ['region'])
  const version = pickString(overview.data, ['version'])

  const actualUsd = billing.data?.totalUsd ?? 0
  const estimatedWindowUsd = estimate.data?.grandTotalUsd ?? 0
  const runRateUsd = estimate.data?.monthlyRunRateUsd ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admin"
        description="Deep health, inventory and where every provider's free tier stands."
        actions={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              void health.refetch()
              void overview.refetch()
              void billing.refetch()
              void estimate.refetch()
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
        }
      />

      <AdminTabs />

      {/* ------------------------------------------------------------- health */}
      <Panel
        title="Health"
        description="Live checks of every dependency the API needs."
        actions={
          health.data ? (
            health.data.ok ? (
              <Badge tone="good">all systems go</Badge>
            ) : (
              <Badge tone="bad">degraded</Badge>
            )
          ) : null
        }
      >
        <QueryState
          isPending={health.isPending}
          isError={health.isError}
          error={health.error}
          refetch={health.refetch}
          loadingLabel="Checking dependencies…"
        />
        {health.data ? <HealthPanel health={health.data} /> : null}
      </Panel>

      {/* ---------------------------------------------------------- inventory */}
      <section className="flex flex-col gap-3">
        <QueryState
          isPending={overview.isPending}
          isError={overview.isError}
          error={overview.error}
          refetch={overview.refetch}
          loadingLabel="Loading inventory…"
        />
        {overview.data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Devices" value={formatNumber(pickNumber(counts, ['devices']))} />
            <StatTile label="Accounts" value={formatNumber(pickNumber(counts, ['users', 'accounts']))} />
            <StatTile
              label="Maps"
              value={formatNumber(pickNumber(counts, ['maps']))}
              hint={formatBytes(pickNumber(counts, ['mapBytes', 'map_bytes', 'bytes']))}
            />
            <StatTile
              label="Parties"
              value={formatNumber(pickNumber(counts, ['sessions', 'parties']))}
              hint={`${formatNumber(pickNumber(counts, ['activeSessions', 'active_sessions']))} active`}
            />
            <StatTile label="Keyframes" value={formatNumber(pickNumber(counts, ['keyframes']), true)} />
            <StatTile
              label="Merges pending"
              value={formatNumber(pickNumber(counts, ['pendingMerges', 'pending_merges']))}
              hint={region ? `${region}${version ? ` · ${version}` : ''}` : undefined}
            />
          </div>
        ) : null}
      </section>

      {/* --------------------------------------------------------------- cost */}
      <Panel
        title="Cost"
        description={`Billed GCP spend over the last ${WINDOW_DAYS} days next to the estimate built from measured usage.`}
        actions={
          <Link className="btn-secondary text-xs" to="/admin/costs">
            Cost console
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              label={`Actual GCP · ${WINDOW_DAYS}d`}
              value={billing.data ? formatUsd(actualUsd) : '—'}
              hint={
                billing.data
                  ? `BigQuery billing export${billing.data.cached ? ' · cached' : ''}`
                  : isNotConfigured(billing.error)
                    ? 'export not configured'
                    : 'unavailable'
              }
            />
            <StatTile
              label={`Estimated · ${WINDOW_DAYS}d`}
              value={estimate.data ? formatUsd(estimatedWindowUsd) : '—'}
              hint="all providers, measured usage"
            />
            <StatTile
              label="Monthly run rate"
              value={estimate.data ? formatUsd(runRateUsd) : '—'}
              hint={
                estimate.data?.generatedAt ? `generated ${formatRelative(estimate.data.generatedAt)}` : 'projected forward'
              }
            />
          </div>

          {billing.isError && isNotConfigured(billing.error) ? (
            <NotConfiguredCard
              feature="The BigQuery billing export"
              doc="monitoring"
              message="Actual spend needs the Cloud Billing export to BigQuery and BILLING_EXPORT_TABLE set on the deployment. The estimate below is computed from measured usage and does not need it."
            />
          ) : null}
          {billing.isError && !isNotConfigured(billing.error) ? (
            <QueryState
              isPending={false}
              isError
              error={billing.error}
              refetch={billing.refetch}
            />
          ) : null}
        </div>
      </Panel>

      {/* ---------------------------------------------------------- free tier */}
      <Panel
        title="Free tiers"
        description="Percentage used of each provider's always-free allowance, the metric that runs out first, and how long it lasts at the current rate."
      >
        <QueryState
          isPending={estimate.isPending}
          isError={estimate.isError}
          error={estimate.error}
          refetch={estimate.refetch}
          loadingLabel="Pricing measured usage…"
          notConfigured={{ feature: 'The cost estimator', doc: 'monitoring' }}
        />
        {estimate.data ? <FreeTierGauges providers={estimate.data.providers} /> : null}
      </Panel>

      {/* ------------------------------------------------------------ actions */}
      <Panel title="Maintenance" description="Both actions run against the deployment this dashboard is pointed at.">
        <AdminActions />
      </Panel>
    </div>
  )
}

export default AdminPage

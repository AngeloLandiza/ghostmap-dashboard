/**
 * `/admin/network` — traffic, latency and errors from `GET /admin/network`.
 */
import { ErrorState, LoadingState, PageHeader, PageStub, StatTile } from '../../components/ui'
import { useAdminNetwork } from '../../lib/api/hooks'
import { formatBytes, formatNumber } from '../../lib/format'

export function AdminNetworkPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useAdminNetwork(24)
  const t = data?.totals

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Network" description="Requests, latency percentiles and bytes over the last 24 hours." />
      {isPending ? <LoadingState label="Loading traffic…" /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {t ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Requests" value={formatNumber(t.requests)} />
          <StatTile label="5xx" value={formatNumber(t.serverErrors)} hint={`${formatNumber(t.clientErrors)} 4xx`} />
          <StatTile label="p95" value={`${Math.round(t.p95Ms)} ms`} hint={`p50 ${Math.round(t.p50Ms)} ms`} />
          <StatTile label="Egress" value={formatBytes(t.bytesOut)} />
          <StatTile label="Ingress" value={formatBytes(t.bytesIn)} />
        </section>
      ) : null}
      <PageStub
        planRef="PLAN section 4 · network"
        todos={[
          'Requests and bytes per hour as a recharts area chart (data.perHour).',
          'By-route table with p95, average, errors and bytes; by-region and by-country breakdowns.',
          'Window selector (1h / 24h / 7d) driving the hours argument of useAdminNetwork.',
        ]}
      />
    </div>
  )
}

export default AdminNetworkPage

/**
 * The two cost tables (PLAN section 3): every priced metric of a `CostReport`, and the raw
 * pricing table behind it. Both show `verified`, `as_of` and the source link, because a
 * number nobody can trace back to a provider's pricing page is not worth showing.
 */
import type { CostItem, PricingEntry, ProviderCost } from '../../lib/api/types'
import { formatNumber, formatUsd } from '../../lib/format'
import { Badge } from '../ui'
import { SourceLink } from './AdminUi'
import { DataTable, type Column } from './DataTable'

/** Unit prices are often fractions of a cent, so they need more digits than money. */
export function formatUnitPrice(value: number, unit?: string | null): string {
  if (!Number.isFinite(value) || value === 0) return 'free'
  const abs = Math.abs(value)
  // Cents keep two decimals; fractions of a cent get enough digits to be readable, with the
  // trailing zeros trimmed so "$0.00000250" reads as "$0.0000025".
  const text =
    abs >= 0.01
      ? value.toFixed(2)
      : value.toFixed(abs < 0.0001 ? 8 : 6).replace(/(\.\d*?[1-9])0+$/, '$1')
  return `$${text}${unit ? ` / ${unit}` : ''}`
}

function quantity(value: number, unit?: string | null): string {
  const text = formatNumber(value, Math.abs(value) >= 10_000)
  return unit ? `${text} ${unit}` : text
}

function VerifiedBadge({ verified, asOf }: { verified: boolean; asOf?: string | null }): JSX.Element {
  return verified ? (
    <Badge tone="good">verified{asOf ? ` ${asOf}` : ''}</Badge>
  ) : (
    <Badge tone="warn">unverified</Badge>
  )
}

/* ------------------------------------------------------- priced metrics table */

export interface MetricRow extends CostItem {
  provider: string
}

/** Flattens `providers[].items[]` into one sortable list. */
export function metricRows(providers: ProviderCost[]): MetricRow[] {
  return providers.flatMap((provider) => provider.items.map((item) => ({ ...item, provider: provider.provider })))
}

export function CostMetricsTable({
  providers,
  emptyLabel = 'No priced metrics in this report yet.',
}: {
  providers: ProviderCost[]
  emptyLabel?: string
}): JSX.Element {
  const rows = metricRows(providers)
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.costUsd) ? row.costUsd : 0), 0)

  const columns: Column<MetricRow>[] = [
    {
      key: 'provider',
      header: 'Provider',
      sortValue: (row) => row.provider,
      render: (row) => <span className="text-ink-300">{row.provider}</span>,
    },
    {
      key: 'metric',
      header: 'Metric',
      sortValue: (row) => row.metric,
      render: (row) => <span className="text-ink-100">{row.metric}</span>,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      align: 'right',
      sortValue: (row) => row.quantity,
      render: (row) => quantity(row.quantity, row.unit),
    },
    {
      key: 'freeQuota',
      header: 'Free quota',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.freeQuota,
      render: (row) => (row.freeQuota > 0 ? quantity(row.freeQuota, row.unit) : <span className="text-ink-600">none</span>),
    },
    {
      key: 'billable',
      header: 'Billable',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.billableQuantity,
      render: (row) =>
        row.billableQuantity > 0 ? (
          quantity(row.billableQuantity, row.unit)
        ) : (
          <span className="text-emerald-400">0</span>
        ),
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.unitPriceUsd,
      render: (row) => <span className="text-ink-300">{formatUnitPrice(row.unitPriceUsd, row.unit)}</span>,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      sortValue: (row) => row.costUsd,
      render: (row) => (
        <span className={row.costUsd > 0 ? 'font-medium text-white' : 'text-ink-500'}>{formatUsd(row.costUsd)}</span>
      ),
    },
    {
      key: 'verified',
      header: 'Price',
      hideOnMobile: true,
      sortValue: (row) => (row.verified ? 1 : 0),
      render: (row) => (
        <div className="flex items-center gap-2">
          <VerifiedBadge verified={row.verified} asOf={row.asOf} />
          <SourceLink href={row.source} asOf={row.asOf} />
        </div>
      ),
    },
  ]

  return (
    <DataTable
      caption="Priced metrics by provider"
      columns={columns}
      rows={rows}
      rowKey={(row, index) => `${row.provider}:${row.metric}:${index}`}
      empty={emptyLabel}
      initialSort={{ key: 'cost', direction: 'desc' }}
      footer={
        <tr>
          <td className="px-2 py-2 text-xs uppercase tracking-wide text-ink-400" colSpan={6}>
            Total
          </td>
          <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">{formatUsd(total)}</td>
          <td className="hidden sm:table-cell" />
        </tr>
      }
    />
  )
}

/* -------------------------------------------------------------- pricing table */

export function PricingTable({ entries }: { entries: PricingEntry[] }): JSX.Element {
  const columns: Column<PricingEntry>[] = [
    {
      key: 'provider',
      header: 'Provider',
      sortValue: (row) => row.provider,
      render: (row) => <span className="text-ink-300">{row.provider}</span>,
    },
    {
      key: 'metric',
      header: 'Metric',
      sortValue: (row) => row.metric,
      render: (row) => (
        <div>
          <p className="text-ink-100">{row.metric}</p>
          {row.note ? <p className="mt-0.5 max-w-md text-xs text-ink-500">{row.note}</p> : null}
        </div>
      ),
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      sortValue: (row) => row.unitPriceUsd,
      render: (row) => formatUnitPrice(row.unitPriceUsd, row.unit),
    },
    {
      key: 'freeQuota',
      header: 'Free quota',
      align: 'right',
      sortValue: (row) => row.freeQuota,
      render: (row) =>
        row.freeQuota > 0 ? (
          `${formatNumber(row.freeQuota, row.freeQuota >= 10_000)}${row.unit ? ` ${row.unit}` : ''}`
        ) : (
          <span className="text-ink-600">none</span>
        ),
    },
    {
      key: 'verified',
      header: 'Checked',
      hideOnMobile: true,
      sortValue: (row) => `${row.verified ? 1 : 0}${row.asOf ?? ''}`,
      render: (row) => <VerifiedBadge verified={row.verified} asOf={row.asOf} />,
    },
    {
      key: 'source',
      header: 'Source',
      align: 'right',
      render: (row) => <SourceLink href={row.source} asOf={row.asOf} />,
    },
  ]

  return (
    <DataTable
      caption="Provider list prices and free quotas"
      columns={columns}
      rows={entries}
      rowKey={(row, index) => `${row.provider}:${row.metric}:${index}`}
      empty="The backend has not published a pricing table yet."
      initialSort={{ key: 'provider', direction: 'asc' }}
    />
  )
}

/**
 * Column-driven table for the admin breakdowns (metrics, pricing, routes, prefixes).
 *
 * Horizontal overflow is contained here so a wide table scrolls inside its card instead of
 * widening the page on a phone, and any column that provides `sortValue` becomes sortable.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export interface Column<Row> {
  key: string
  header: ReactNode
  render: (row: Row, index: number) => ReactNode
  align?: 'left' | 'right'
  /** Makes the column sortable; return a number or a string. */
  sortValue?: (row: Row) => number | string | null | undefined
  /** Extra classes for the cells of this column. */
  cellClassName?: string
  /** Hides the column below the `sm` breakpoint. */
  hideOnMobile?: boolean
}

export interface DataTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  empty?: ReactNode
  /** Rendered as a `<tfoot>` row, typically the totals. */
  footer?: ReactNode
  /** Column key to sort by on first render. */
  initialSort?: { key: string; direction: 'asc' | 'desc' }
  /** Caption for screen readers. */
  caption?: string
}

function compare(a: number | string | null | undefined, b: number | string | null | undefined): number {
  const av = a ?? ''
  const bv = b ?? ''
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv), undefined, { numeric: true })
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
  footer,
  initialSort,
  caption,
}: DataTableProps<Row>): JSX.Element {
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => factor * compare(column.sortValue?.(a), column.sortValue?.(b)))
  }, [rows, columns, sort])

  if (rows.length === 0) return <p className="py-6 text-center text-sm text-ink-500">{empty}</p>

  const toggle = (key: string): void =>
    setSort((prev) =>
      prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' },
    )

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-ink-700/70 text-left">
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue)
              const active = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={[
                    'whitespace-nowrap px-2 py-2 text-xs font-medium uppercase tracking-wide text-ink-400',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.hideOnMobile ? 'hidden sm:table-cell' : '',
                  ].join(' ')}
                  aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={`inline-flex items-center gap-1 hover:text-ink-200 ${active ? 'text-ghost-400' : ''}`}
                    >
                      {column.header}
                      {active ? (
                        sort?.direction === 'asc' ? (
                          <ChevronUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b border-ink-800/60 last:border-0 hover:bg-ink-850/40">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={[
                    'px-2 py-2 align-top',
                    column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                    column.hideOnMobile ? 'hidden sm:table-cell' : '',
                    column.cellClassName ?? '',
                  ].join(' ')}
                >
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot className="border-t border-ink-700/70 text-ink-200">{footer}</tfoot> : null}
      </table>
    </div>
  )
}

export default DataTable

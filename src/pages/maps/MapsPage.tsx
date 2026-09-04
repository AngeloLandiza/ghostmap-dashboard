/**
 * `/` — the map library (PLAN section 4).
 *
 * A card grid over `GET /v1/maps`: thumbnail, name, points, keyframes, duration, size,
 * status, owner and age. Status is filtered server-side (the backend already scopes the list
 * to what the caller may see), the name box filters the pages already loaded, and paging
 * follows `next_cursor` through `useMapsInfinite`.
 */
import { useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, Spinner } from '../../components/ui'
import { useMapsInfinite } from '../../lib/api/hooks'
import type { MapRecord, MapStatus } from '../../lib/api/types'
import { formatBytes, formatNumber } from '../../lib/format'
import MapCard from './MapCard'

const PAGE_SIZE = 24

const FILTERS: { label: string; value: MapStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Saved', value: 'saved' },
  { label: 'Uploading', value: 'uploading' },
  { label: 'Failed', value: 'failed' },
]

/** Cursor pages can overlap when rows share a timestamp; keep the first of each id. */
function dedupe(maps: MapRecord[]): MapRecord[] {
  const seen = new Set<string>()
  const out: MapRecord[] = []
  for (const map of maps) {
    if (!map.id || seen.has(map.id)) continue
    seen.add(map.id)
    out.push(map)
  }
  return out
}

function SkeletonCard(): JSX.Element {
  return (
    <div className="card overflow-hidden">
      <div className="aspect-[16/10] w-full animate-pulse bg-ink-850" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-4 w-2/3 animate-pulse rounded bg-ink-850" />
        <div className="h-3 w-full animate-pulse rounded bg-ink-850/70" />
      </div>
    </div>
  )
}

export function MapsPage(): JSX.Element {
  const [status, setStatus] = useState<MapStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const params = useMemo(
    () => ({ limit: PAGE_SIZE, ...(status === 'all' ? {} : { status }) }),
    [status],
  )
  const query = useMapsInfinite(params)

  const maps = useMemo(
    () => dedupe(query.data?.pages.flatMap((page) => page.maps) ?? []),
    [query.data],
  )

  const term = search.trim().toLowerCase()
  const visible = term ? maps.filter((map) => map.name.toLowerCase().includes(term)) : maps

  const totals = useMemo(
    () =>
      maps.reduce(
        (acc, map) => ({ points: acc.points + map.pointCount, bytes: acc.bytes + map.sizeBytes }),
        { points: 0, bytes: 0 },
      ),
    [maps],
  )

  return (
    <div>
      <PageHeader
        title="Maps"
        description={
          maps.length > 0
            ? `${formatNumber(maps.length)} loaded · ${formatNumber(totals.points, true)} points · ${formatBytes(totals.bytes)}`
            : 'Every capture uploaded from the Ghostmap app.'
        }
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? <Spinner /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                status === filter.value
                  ? 'bg-ink-800 text-white'
                  : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <label className="relative sm:w-64">
          <span className="sr-only">Filter maps by name</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          <input
            type="search"
            className="input pl-9"
            placeholder="Filter by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}

      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_unused, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : null}

      {!query.isPending && !query.isError && visible.length === 0 ? (
        <EmptyState
          title={term ? 'No maps match that name' : status === 'all' ? 'No maps yet' : `No ${status} maps`}
          description={
            term
              ? 'Clear the filter to see the whole library.'
              : 'Capture a room in the Ghostmap app and upload it; it will show up here.'
          }
          action={
            term ? (
              <button type="button" className="btn-secondary mt-2" onClick={() => setSearch('')}>
                Clear filter
              </button>
            ) : undefined
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((map) => (
            <li key={map.id}>
              <MapCard map={map} />
            </li>
          ))}
        </ul>
      ) : null}

      {query.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? <Spinner /> : null}
            Load more
          </button>
        </div>
      ) : null}

      {query.isFetchingNextPage && !query.hasNextPage ? <LoadingState label="Loading more maps…" /> : null}
    </div>
  )
}

export default MapsPage

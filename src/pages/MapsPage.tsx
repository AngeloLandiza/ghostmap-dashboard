/**
 * `/` — the map library (PLAN section 4).
 *
 * Scaffold only: it proves the API pipe works and leaves the card grid to the maps agent.
 */
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader, PageStub } from '../components/ui'
import { useMaps } from '../lib/api/hooks'
import { formatBytes, formatNumber } from '../lib/format'

export function MapsPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useMaps({ limit: 24 })
  const maps = data?.maps ?? []

  return (
    <div>
      <PageHeader title="Maps" description="Every capture uploaded from the Ghostmap app." />

      {isPending ? <LoadingState label="Loading maps…" /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {!isPending && !isError ? (
        <PageStub
          planRef="PLAN section 4 · maps library"
          todos={[
            'Card grid: thumbnail (GET /v1/maps/:id/files/thumbnail.png), name, points, keyframes, duration, size, status, owner.',
            'Filters for status and session, cursor pagination with next_cursor from useMaps.',
            'Link each card to /maps/:id.',
          ]}
        >
          <ul className="flex flex-col gap-2">
            {maps.map((map) => (
              <li key={map.id}>
                <Link
                  to={`/maps/${map.id}`}
                  className="card flex items-center justify-between gap-4 p-3 transition-colors hover:border-ghost-700/70"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{map.name || 'Untitled map'}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {formatNumber(map.pointCount, true)} points · {formatNumber(map.keyframeCount)} keyframes ·{' '}
                      {formatBytes(map.sizeBytes)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">{map.status}</span>
                </Link>
              </li>
            ))}
            {maps.length === 0 ? <li className="text-sm text-ink-400">No maps yet.</li> : null}
          </ul>
        </PageStub>
      ) : null}
    </div>
  )
}

export default MapsPage

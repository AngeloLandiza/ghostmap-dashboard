/**
 * One card in the map library.
 *
 * `GET /v1/maps` does not carry signed URLs, so the thumbnail comes from `map.thumbnail_url`
 * when the backend serves one and otherwise from the map's own `downloads["thumbnail.png"]`.
 * That detail request is deferred until the card scrolls into view, which keeps a long
 * library to one round trip per visible card — and warms the cache for `/maps/:id`, so
 * opening a map from the grid renders immediately.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Boxes } from 'lucide-react'
import { Badge } from '../../components/ui'
import { useMap } from '../../lib/api/hooks'
import type { MapRecord, MapStatus } from '../../lib/api/types'
import { formatBytes, formatDuration, formatNumber, formatRelative } from '../../lib/format'
import { ownerLabel } from './access'

export function statusTone(status: MapStatus): 'good' | 'info' | 'bad' | 'neutral' {
  if (status === 'saved') return 'good'
  if (status === 'uploading') return 'info'
  if (status === 'failed') return 'bad'
  return 'neutral'
}

/** True once the element has been near the viewport at least once. */
function useNearViewport<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near) return
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])

  return [ref, near]
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="truncate tabular-nums text-ink-300">{value}</dd>
    </div>
  )
}

export function MapCard({ map }: { map: MapRecord }): JSX.Element {
  const [ref, near] = useNearViewport<HTMLDivElement>()

  // `files` is empty on backends that do not list them yet, so an unknown file set still
  // gets one attempt rather than showing a placeholder forever.
  const mayHaveThumbnail = map.files.length === 0 || map.files.includes('thumbnail.png')
  const wantsDetail = near && !map.thumbnailUrl && map.status !== 'deleted' && mayHaveThumbnail
  const detail = useMap(map.id, { enabled: wantsDetail, staleTime: 4 * 60_000 })
  const source = map.thumbnailUrl ?? detail.data?.downloads?.['thumbnail.png']?.url ?? null

  const [broken, setBroken] = useState(false)
  const src = broken ? null : source

  return (
    <Link
      to={`/maps/${map.id}`}
      className="card group flex h-full flex-col overflow-hidden transition-colors hover:border-ghost-700/70"
    >
      <div ref={ref} className="relative aspect-[16/10] w-full overflow-hidden bg-ink-950">
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-900 to-ink-950">
            <Boxes className="h-8 w-8 text-ink-700" aria-hidden />
          </div>
        )}
        <span className="absolute left-2 top-2">
          <Badge tone={statusTone(map.status)}>{map.status}</Badge>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h2 className="truncate text-sm font-medium text-white">{map.name || 'Untitled map'}</h2>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
          <Stat label="Points" value={formatNumber(map.pointCount, true)} />
          <Stat label="Keyframes" value={formatNumber(map.keyframeCount, true)} />
          <Stat label="Duration" value={formatDuration(map.durationS)} />
          <Stat label="Size" value={formatBytes(map.sizeBytes)} />
        </dl>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-ink-500">
          <span className="truncate">{ownerLabel(map)}</span>
          <time dateTime={map.createdAt ?? undefined} className="shrink-0">
            {formatRelative(map.createdAt)}
          </time>
        </div>
      </div>
    </Link>
  )
}

export default MapCard

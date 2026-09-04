/**
 * `/maps/:id` — PLY viewer (PLAN section 4). This chunk owns three.js: the map agent
 * should import `@react-three/fiber` / `@react-three/drei` here so the library stays out of
 * every other route's bundle.
 */
import { useParams } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader, PageStub } from '../components/ui'
import { useMap } from '../lib/api/hooks'
import { formatBytes, formatDuration, formatNumber } from '../lib/format'

export function MapDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const { data, isPending, isError, error, refetch } = useMap(id)

  if (isPending) return <LoadingState label="Loading map…" />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  const map = data?.map
  return (
    <div>
      <PageHeader
        title={map?.name || 'Map'}
        description={
          map
            ? `${formatNumber(map.pointCount)} points · ${formatNumber(map.keyframeCount)} keyframes · ${formatDuration(
                map.durationS,
              )} · ${formatBytes(map.sizeBytes)}`
            : undefined
        }
      />
      <PageStub
        planRef="PLAN section 4 · map detail"
        todos={[
          'three.js PLY viewer with orbit / pan / zoom, loading cloud.ply from data.downloads["cloud.ply"].url.',
          'Stats panel (points, keyframes, duration, size, bbox, origin, owner) and the manifest.',
          'Download PLY, rename (useRenameMap) and delete (useDeleteMap) when the caller owns the map.',
          'Keep every three.js import inside this lazy chunk.',
        ]}
      />
    </div>
  )
}

export default MapDetailPage

/**
 * `/maps/:id` — the point-cloud viewer (PLAN section 4).
 *
 * `GET /v1/maps/:id` returns the record plus signed `downloads`; `cloud.ply` is streamed and
 * parsed off the main thread (`usePlyCloud`) and rendered with react-three-fiber. The panel
 * beside it reports what the manifest says about the capture, links every stored file, and —
 * for the map's owner or an admin — renames and deletes it.
 *
 * three.js only exists inside this lazily loaded chunk.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Grid3x3, Maximize2, Orbit, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { Badge, ErrorState, LoadingState, PageHeader, Spinner } from '../../components/ui'
import PointCloudViewer, { suggestedPointSize, type ViewMode } from '../../components/viewer/PointCloudViewer'
import { usePlyCloud } from '../../components/viewer/usePlyCloud'
import { api, errorMessage } from '../../lib/api/client'
import { useDeleteMap, useMap, useRenameMap } from '../../lib/api/hooks'
import type { MapRecord, SignedUrl } from '../../lib/api/types'
import { useAuth } from '../../lib/auth'
import { formatBytes, formatDateTime, formatDuration, formatNumber } from '../../lib/format'
import { canManageMap, ownerLabel } from './access'
import { statusTone } from './MapCard'

type Vec3 = [number, number, number]

/** Reads `{ min: [x,y,z], max: [x,y,z] }` out of the manifest's bbox, if it is shaped that way. */
function manifestBounds(raw: Record<string, unknown> | null): { min: Vec3; max: Vec3 } | null {
  if (!raw) return null
  const min = raw.min
  const max = raw.max
  const ok = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number')
  if (!ok(min) || !ok(max)) return null
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
}

/** `origin.type` from the map record, defaulting to the capture frame the app uses. */
function originLabel(origin: Record<string, unknown> | null): string {
  const type = origin?.type
  return typeof type === 'string' && type ? type : 'session-start'
}

function dimensions(bounds: { min: Vec3; max: Vec3 } | null): string {
  if (!bounds) return '—'
  const d = [0, 1, 2].map((i) => Math.abs(bounds.max[i] - bounds.min[i]))
  return `${d[0].toFixed(1)} × ${d[1].toFixed(1)} × ${d[2].toFixed(1)} m`
}

function Row({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-800/60 py-1.5 last:border-0">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-ink-200">{value}</dd>
    </div>
  )
}

/* ------------------------------------------------------------- title + actions */

function RenameForm({ map, onDone }: { map: MapRecord; onDone: () => void }): JSX.Element {
  const rename = useRenameMap()
  const [name, setName] = useState(map.name)

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed || trimmed === map.name) {
          onDone()
          return
        }
        rename.mutate({ id: map.id, name: trimmed }, { onSuccess: onDone })
      }}
    >
      <input
        className="input sm:w-64"
        value={name}
        autoFocus
        maxLength={120}
        aria-label="Map name"
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" className="btn-primary" disabled={rename.isPending}>
        {rename.isPending ? <Spinner /> : null}
        Save
      </button>
      <button type="button" className="btn-ghost" onClick={onDone} disabled={rename.isPending}>
        Cancel
      </button>
      {rename.isError ? <span className="text-xs text-red-400">{errorMessage(rename.error)}</span> : null}
    </form>
  )
}

/* ------------------------------------------------------------------- the page */

export function MapDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isAdmin, user, token } = useAuth()

  const query = useMap(id)
  const map = query.data?.map ?? null
  const downloads: Record<string, SignedUrl> = query.data?.downloads ?? {}
  const cloudUrl = downloads['cloud.ply']?.url ?? null
  const proxyUrl = id ? api.maps.fileUrl(id, 'cloud.ply') : null

  const [view, setView] = useState<ViewMode>('orbit')
  const [showGrid, setShowGrid] = useState(true)
  const [sizeScale, setSizeScale] = useState(1)
  const [frameSignal, setFrameSignal] = useState(0)
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const ply = usePlyCloud(cloudUrl, { proxyUrl, token })
  const remove = useDeleteMap()

  const canManage = canManageMap(map, { isAdmin, userId: user?.id ?? null })
  const bounds = useMemo(
    () => (ply.cloud ? { min: ply.cloud.bbox.min, max: ply.cloud.bbox.max } : manifestBounds(map?.bbox ?? null)),
    [ply.cloud, map],
  )
  const pointSize = (ply.cloud ? suggestedPointSize(ply.cloud) : 0.01) * sizeScale

  if (query.isPending) return <LoadingState label="Loading map…" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!map) return <ErrorState error={new Error('The backend returned no map')} onRetry={() => void query.refetch()} />

  const percent = ply.progress.total > 0 ? Math.min(100, (ply.progress.loaded / ply.progress.total) * 100) : 0

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-200">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Maps
      </Link>

      <PageHeader
        title={map.name || 'Untitled map'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(map.status)}>{map.status}</Badge>
            <span>
              {formatNumber(map.pointCount, true)} points · {formatNumber(map.keyframeCount)} keyframes ·{' '}
              {formatDuration(map.durationS)} · {formatBytes(map.sizeBytes)}
            </span>
          </span>
        }
        actions={
          <>
            {cloudUrl ? (
              <a className="btn-primary" href={cloudUrl} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" aria-hidden />
                Download PLY
              </a>
            ) : null}
            {canManage ? (
              <button type="button" className="btn-secondary" onClick={() => setRenaming((v) => !v)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Rename
              </button>
            ) : null}
            {canManage ? (
              confirmingDelete ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(map.id, { onSuccess: () => navigate('/', { replace: true }) })
                    }
                  >
                    {remove.isPending ? <Spinner /> : <Trash2 className="h-4 w-4" aria-hidden />}
                    Delete for good
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </button>
              )
            ) : null}
          </>
        }
      />

      {renaming && canManage ? (
        <div className="mb-4">
          <RenameForm map={map} onDone={() => setRenaming(false)} />
        </div>
      ) : null}
      {remove.isError ? (
        <div className="mb-4">
          <ErrorState error={remove.error} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------------------ viewer */}
        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-800/80 px-3 py-2">
            <div role="group" aria-label="Camera" className="flex gap-1">
              {(['orbit', 'top'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors ${
                    view === mode ? 'bg-ink-800 text-white' : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
                  }`}
                >
                  {mode === 'orbit' ? 'Orbit' : 'Top down'}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn-ghost px-2 py-1.5 text-xs"
              onClick={() => setFrameSignal((n) => n + 1)}
              title="Fit the cloud in view"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              Fit
            </button>
            <button
              type="button"
              aria-pressed={showGrid}
              className={`btn-ghost px-2 py-1.5 text-xs ${showGrid ? 'text-ghost-400' : ''}`}
              onClick={() => setShowGrid((v) => !v)}
              title="Toggle the floor grid"
            >
              <Grid3x3 className="h-3.5 w-3.5" aria-hidden />
              Grid
            </button>

            <label className="ml-auto flex items-center gap-2 text-xs text-ink-400">
              <span className="hidden sm:inline">Point size</span>
              <input
                type="range"
                min={0.3}
                max={4}
                step={0.05}
                value={sizeScale}
                aria-label="Point size"
                onChange={(event) => setSizeScale(Number(event.target.value))}
                className="h-1 w-24 cursor-pointer accent-ghost-500 sm:w-32"
              />
              <span className="w-12 tabular-nums text-ink-500">{(pointSize * 1000).toFixed(0)} mm</span>
            </label>
          </div>

          <div className="relative h-[52vh] min-h-[300px] w-full bg-ink-950 lg:h-[62vh]">
            {ply.cloud && ply.cloud.count > 0 ? (
              <PointCloudViewer
                cloud={ply.cloud}
                pointSize={pointSize}
                view={view}
                showGrid={showGrid}
                frameSignal={frameSignal}
              />
            ) : null}

            {ply.status === 'loading' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/80 p-6 text-center">
                <Orbit className="h-6 w-6 animate-spin text-ghost-500" aria-hidden />
                <div className="w-full max-w-xs">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-ghost-500 transition-[width] duration-200"
                      style={{ width: `${Math.max(4, percent)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-ink-400">
                    {ply.progress.total > 0
                      ? `${percent.toFixed(0)}% · ${formatBytes(ply.progress.loaded)} of ${formatBytes(ply.progress.total)}`
                      : formatBytes(ply.progress.loaded)}
                  </p>
                  <p className="text-xs text-ink-500">
                    {ply.progress.points > 0 ? `${formatNumber(ply.progress.points, true)} points parsed` : 'Downloading cloud.ply…'}
                    {ply.fallback ? ' · main-thread fallback' : ''}
                  </p>
                </div>
              </div>
            ) : null}

            {ply.status === 'error' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <TriangleAlert className="h-6 w-6 text-red-400" aria-hidden />
                <p className="text-sm text-ink-200">Could not load the point cloud</p>
                <p className="max-w-md text-xs text-ink-500">{ply.error}</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={ply.reload}>
                    Try again
                  </button>
                  {cloudUrl ? (
                    <a className="btn-ghost" href={cloudUrl} target="_blank" rel="noreferrer">
                      Download instead
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {ply.status === 'idle' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm text-ink-300">No point cloud for this map</p>
                <p className="max-w-sm text-xs text-ink-500">
                  {map.status === 'uploading'
                    ? 'The capture is still uploading; cloud.ply appears once the map is finalized.'
                    : 'The backend did not return a signed URL for cloud.ply.'}
                </p>
              </div>
            ) : null}

            {ply.status === 'ready' && ply.cloud && ply.cloud.count === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-400">
                cloud.ply contains no points.
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800/80 px-3 py-2 text-xs text-ink-500">
            <span>
              {ply.cloud
                ? `${formatNumber(ply.cloud.count, true)} of ${formatNumber(ply.cloud.total, true)} points${
                    ply.cloud.stride > 1 ? ` · every ${ply.cloud.stride}${ply.cloud.stride === 2 ? 'nd' : 'th'} point` : ''
                  }`
                : 'Drag to orbit · right-drag or two fingers to pan · scroll to zoom'}
            </span>
            <span>{dimensions(bounds)}</span>
          </div>
        </section>

        {/* ------------------------------------------------------------- stats */}
        <aside className="flex flex-col gap-4">
          <div className="card p-4">
            <h2 className="mb-2 text-sm font-medium text-white">Capture</h2>
            <dl>
              <Row label="Points" value={formatNumber(map.pointCount)} />
              <Row label="Keyframes" value={formatNumber(map.keyframeCount)} />
              <Row label="Duration" value={formatDuration(map.durationS)} />
              <Row label="Size" value={formatBytes(map.sizeBytes)} />
              <Row label="Dimensions" value={dimensions(bounds)} />
              <Row label="Frame" value={map.frame || '—'} />
              <Row label="Origin" value={originLabel(map.origin)} />
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-medium text-white">Provenance</h2>
            <dl>
              <Row label="Owner" value={ownerLabel(map)} />
              <Row label="Device" value={map.deviceId ? map.deviceId.slice(0, 8) : '—'} />
              <Row
                label="Party"
                value={
                  map.sessionId ? (
                    <Link className="text-ghost-400 hover:text-ghost-300" to={`/parties/${map.sessionId}`}>
                      {map.sessionId.slice(0, 8)}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <Row label="Version" value={`v${map.version}`} />
              <Row label="Created" value={formatDateTime(map.createdAt)} />
              <Row label="Finalized" value={formatDateTime(map.finalizedAt)} />
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-medium text-white">Files</h2>
            {Object.keys(downloads).length === 0 ? (
              <p className="text-xs text-ink-500">The backend returned no signed download URLs.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {Object.entries(downloads).map(([name, signed]) => (
                  <li key={name} className="flex items-center justify-between gap-2 text-sm">
                    <a
                      href={signed.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-ghost-400 hover:text-ghost-300"
                    >
                      {name}
                    </a>
                    <Download className="h-3.5 w-3.5 shrink-0 text-ink-600" aria-hidden />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {map.manifest ? (
            <details className="card p-4">
              <summary className="cursor-pointer text-sm font-medium text-white">Manifest</summary>
              <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-ink-950/70 p-3 text-[11px] leading-relaxed text-ink-300">
                {JSON.stringify(map.manifest, null, 2)}
              </pre>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

export default MapDetailPage

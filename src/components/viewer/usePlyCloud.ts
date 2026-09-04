/**
 * Loads `cloud.ply` into typed arrays the viewer can hand straight to a `BufferGeometry`.
 *
 * Fast path: a Web Worker streams and parses the file (see `plyWorker.ts`), so the main
 * thread stays at 60 fps while hundreds of megabytes go by. Fallback: if the browser cannot
 * start the worker, or the file is a shape the fast path does not read (ASCII bodies, odd
 * property layouts), the same download is parsed on the main thread with three's `PLYLoader`,
 * which is dynamically imported so it is only fetched when it is actually needed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PlyWorker from './plyWorker?worker'
import { heightRamp, strideForBudget } from './ply'
import type { PointCloudData } from './ply'
import type { PlySource, PlyWorkerResponse } from './plyWorker'

/** PLAN section 4: decimate by stride past two million points. */
export const DEFAULT_MAX_POINTS = 2_000_000

export type PlyStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PlyProgress {
  /** Bytes downloaded so far. */
  loaded: number
  /** Total bytes, when the server sent a Content-Length (0 otherwise). */
  total: number
  /** Points parsed so far. */
  points: number
}

export interface PlyCloudState {
  status: PlyStatus
  cloud: PointCloudData | null
  error: string | null
  progress: PlyProgress
  /** True while the main-thread PLYLoader fallback is running. */
  fallback: boolean
  reload: () => void
}

export interface UsePlyCloudOptions {
  /** Tried when the signed URL fails (the API's `/v1/maps/:id/files/:name` redirect). */
  proxyUrl?: string | null
  /** Bearer token, sent with the proxy attempt only. */
  token?: string | null
  maxPoints?: number
}

const EMPTY_PROGRESS: PlyProgress = { loaded: 0, total: 0, points: 0 }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* ------------------------------------------------ main-thread PLYLoader path */

async function download(
  sources: PlySource[],
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  let last: unknown = new Error('No download URL for cloud.ply')
  for (const source of sources) {
    if (!source.url) continue
    try {
      const response = await fetch(source.url, { headers: source.headers ?? {}, signal, credentials: 'omit' })
      if (!response.ok) {
        last = new Error(`HTTP ${response.status} ${response.statusText}`.trim())
        continue
      }
      const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      const total = Number.isFinite(declared) && declared > 0 ? declared : 0
      const body = response.body
      if (!body) return await response.arrayBuffer()

      const reader = body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        chunks.push(value)
        loaded += value.length
        onProgress(loaded, total)
      }
      const merged = new Uint8Array(loaded)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      return merged.buffer
    } catch (error) {
      if (signal.aborted) throw error
      last = error
    }
  }
  throw last instanceof Error ? last : new Error(describe(last))
}

/** Parses with three's `PLYLoader`, then applies the same stride decimation as the worker. */
async function parseWithPlyLoader(buffer: ArrayBuffer, maxPoints: number): Promise<PointCloudData> {
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
  const geometry = new PLYLoader().parse(buffer)
  const position = geometry.getAttribute('position')
  if (!position) throw new Error('cloud.ply has no vertex positions')
  const color = geometry.getAttribute('color')

  const total = position.count
  const stride = strideForBudget(total, maxPoints)
  const count = total > 0 ? Math.floor((total - 1) / stride) + 1 : 0
  const positions = new Float32Array(count * 3)
  let colors: Float32Array = new Float32Array(count * 3)

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]

  let k = 0
  for (let i = 0; i < total && k < count; i += stride, k += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const o = k * 3
    positions[o] = x
    positions[o + 1] = y
    positions[o + 2] = z
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
    if (color) {
      colors[o] = color.getX(i)
      colors[o + 1] = color.getY(i)
      colors[o + 2] = color.getZ(i)
    }
  }
  geometry.dispose()

  const empty = count === 0 || !Number.isFinite(min[0])
  const bbox = empty
    ? { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] }
    : { min, max }
  if (!color && count > 0) colors = heightRamp(positions, count, bbox.min[1], bbox.max[1])

  return { positions, colors, count, total, stride, bbox }
}

/* ---------------------------------------------------------------- the hook */

export function usePlyCloud(url: string | null | undefined, options: UsePlyCloudOptions = {}): PlyCloudState {
  const { proxyUrl = null, token = null, maxPoints = DEFAULT_MAX_POINTS } = options
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<PlyStatus>('idle')
  const [cloud, setCloud] = useState<PointCloudData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<PlyProgress>(EMPTY_PROGRESS)
  const [fallback, setFallback] = useState(false)
  const frame = useRef(0)

  const sources = useMemo<PlySource[]>(() => {
    const list: PlySource[] = []
    if (url) list.push({ url })
    if (proxyUrl) list.push({ url: proxyUrl, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) })
    return list
  }, [url, proxyUrl, token])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (sources.length === 0) {
      setStatus('idle')
      setCloud(null)
      setError(null)
      setProgress(EMPTY_PROGRESS)
      return
    }

    let cancelled = false
    let settled = false
    let worker: Worker | null = null
    const controller = new AbortController()

    setStatus('loading')
    setError(null)
    setCloud(null)
    setFallback(false)
    setProgress(EMPTY_PROGRESS)

    /** Coalesce progress into one state update per animation frame. */
    const report = (next: PlyProgress): void => {
      if (cancelled) return
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        if (!cancelled) setProgress(next)
      })
    }

    const runFallback = (reason: string): void => {
      if (cancelled || settled) return
      settled = true
      setFallback(true)
      download(sources, controller.signal, (loaded, total) => report({ loaded, total, points: 0 }))
        .then((buffer) => parseWithPlyLoader(buffer, maxPoints))
        .then((parsed) => {
          if (cancelled) return
          setCloud(parsed)
          setProgress({ loaded: 0, total: 0, points: parsed.count })
          setStatus('ready')
        })
        .catch((e: unknown) => {
          if (cancelled || controller.signal.aborted) return
          setError(`${describe(e)}${reason ? ` (after: ${reason})` : ''}`)
          setStatus('error')
        })
    }

    try {
      worker = new PlyWorker()
    } catch {
      worker = null
    }

    if (!worker) {
      runFallback('')
    } else {
      const active = worker
      active.onmessage = (event: MessageEvent<PlyWorkerResponse>) => {
        if (cancelled) return
        const message = event.data
        if (message.type === 'progress') {
          report({ loaded: message.loaded, total: message.total, points: message.points })
          return
        }
        if (message.type === 'done') {
          settled = true
          const { positions, colors, count, total, stride, bbox } = message
          setCloud({ positions, colors, count, total, stride, bbox })
          setProgress({ loaded: 0, total: 0, points: count })
          setStatus('ready')
          active.terminate()
          return
        }
        active.terminate()
        if (message.code === 'unsupported') {
          runFallback(message.message)
          return
        }
        if (settled) return
        settled = true
        setError(message.message)
        setStatus('error')
      }
      active.onerror = () => {
        active.terminate()
        runFallback('the point-cloud worker failed to start')
      }
      active.postMessage({ type: 'load', sources, maxPoints })
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(frame.current)
      controller.abort()
      worker?.terminate()
    }
  }, [sources, maxPoints, attempt])

  return { status, cloud, error, progress, fallback, reload }
}

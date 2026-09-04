/**
 * Web Worker that downloads and parses `cloud.ply`.
 *
 * Everything expensive — the network read, the binary parse, the decimation and the sRGB
 * conversion — happens off the main thread, and the finished typed arrays are *transferred*
 * (not copied) back, so opening a 300 MB cloud never blocks a frame. Progress is posted a
 * few times a second so the UI can show a real bar instead of a spinner.
 *
 * The worker only handles binary PLY. Anything else answers `error` with `code:
 * "unsupported"`, and the hook retries on the main thread with three's `PLYLoader`.
 */
import { PlyFormatError, PlyPointParser, PlyUnsupportedError, findHeaderEnd, parsePlyHeader } from './ply'
import type { PointCloudData } from './ply'

/** One place to try; the hook passes the signed URL first and the API proxy as a backup. */
export interface PlySource {
  url: string
  headers?: Record<string, string>
}

export interface PlyLoadRequest {
  type: 'load'
  sources: PlySource[]
  /** Point budget; more than this and the parser decimates by stride. */
  maxPoints: number
}

export type PlyWorkerResponse =
  | { type: 'progress'; loaded: number; total: number; points: number }
  | ({ type: 'done' } & PointCloudData)
  | { type: 'error'; code: 'unsupported' | 'network' | 'parse'; message: string }

const ctx = self as unknown as {
  postMessage(message: PlyWorkerResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<PlyLoadRequest>) => void): void
}

const PROGRESS_INTERVAL_MS = 120

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

async function openStream(sources: PlySource[]): Promise<Response> {
  let last: unknown = new Error('No download URL for cloud.ply')
  for (const source of sources) {
    if (!source.url) continue
    try {
      const response = await fetch(source.url, {
        headers: source.headers ?? {},
        mode: 'cors',
        credentials: 'omit',
      })
      if (response.ok) return response
      last = new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error(describe(last))
}

async function load(request: PlyLoadRequest): Promise<void> {
  const response = await openStream(request.sources)
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0

  const body = response.body
  let parser: PlyPointParser | null = null
  let loaded = 0
  let lastPost = 0

  const post = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastPost < PROGRESS_INTERVAL_MS) return
    lastPost = now
    ctx.postMessage({
      type: 'progress',
      loaded,
      total: total || (parser ? parser.bodyBytes : 0),
      points: parser ? parser.points : 0,
    })
  }

  if (!body) {
    // No streaming (very old browsers, or a proxy that buffers): one shot instead.
    const buffer = new Uint8Array(await response.arrayBuffer())
    loaded = buffer.length
    const headerEnd = findHeaderEnd(buffer)
    if (headerEnd < 0) throw new Error('cloud.ply is truncated: no PLY header')
    parser = new PlyPointParser(parsePlyHeader(buffer), request.maxPoints)
    parser.push(buffer.subarray(headerEnd))
  } else {
    const reader = body.getReader()
    let pending: Uint8Array[] = []
    let pendingBytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.length === 0) continue
      loaded += value.length

      if (!parser) {
        pending.push(value)
        pendingBytes += value.length
        const merged = concat(pending, pendingBytes)
        const headerEnd = findHeaderEnd(merged)
        if (headerEnd < 0) {
          pending = [merged]
          post()
          continue
        }
        parser = new PlyPointParser(parsePlyHeader(merged), request.maxPoints)
        pending = []
        pendingBytes = 0
        parser.push(merged.subarray(headerEnd))
      } else {
        parser.push(value)
      }

      post()
      if (parser.complete) {
        void reader.cancel().catch(() => undefined)
        break
      }
    }
  }

  if (!parser) throw new Error('cloud.ply is empty')
  post(true)

  const cloud = parser.finish()
  ctx.postMessage({ type: 'done', ...cloud }, [cloud.positions.buffer, cloud.colors.buffer])
}

ctx.addEventListener('message', (event: MessageEvent<PlyLoadRequest>) => {
  const request = event.data
  if (!request || request.type !== 'load') return
  load(request).catch((error: unknown) => {
    // Anything the fast path cannot read is worth one more try with three's PLYLoader.
    const fallbackWorthy = error instanceof PlyUnsupportedError || error instanceof PlyFormatError
    const code = fallbackWorthy ? 'unsupported' : 'network'
    ctx.postMessage({ type: 'error', code, message: describe(error) })
  })
})

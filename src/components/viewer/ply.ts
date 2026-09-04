/**
 * Streaming PLY reader for the map viewer.
 *
 * The Ghostmap app writes `cloud.ply` as binary little-endian with
 * `x y z` floats and `red green blue` bytes, which can be tens of millions of points. This
 * parser is deliberately allocation-frugal so it can run inside a Web Worker and consume the
 * response body chunk by chunk:
 *
 *  - the vertex count is known from the header, so the output arrays are allocated **once**;
 *  - `stride` decimation is applied *while* parsing, so a 20 M point file never materializes
 *    more than the point budget the viewer asked for;
 *  - colours are converted from sRGB bytes to linear floats exactly like three's `PLYLoader`
 *    does, so the two code paths (worker fast path, `PLYLoader` fallback) look identical.
 *
 * Anything this parser does not understand (ASCII bodies, exotic property layouts, list
 * properties before the vertex element) raises {@link PlyUnsupportedError}; the caller then
 * falls back to three's `PLYLoader` on the main thread.
 */

export type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian'

export type PlyScalar = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64'

const SCALAR_ALIASES: Readonly<Record<string, PlyScalar>> = {
  char: 'int8',
  int8: 'int8',
  uchar: 'uint8',
  uint8: 'uint8',
  short: 'int16',
  int16: 'int16',
  ushort: 'uint16',
  uint16: 'uint16',
  int: 'int32',
  int32: 'int32',
  uint: 'uint32',
  uint32: 'uint32',
  float: 'float32',
  float32: 'float32',
  double: 'float64',
  float64: 'float64',
}

const SCALAR_BYTES: Readonly<Record<PlyScalar, number>> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
}

export interface PlyProperty {
  name: string
  type: PlyScalar
  /** Byte offset inside one row of the element. */
  offset: number
}

export interface PlyElementSpec {
  name: string
  count: number
  /** Fixed row size in bytes; meaningless when {@link hasList} is true. */
  rowBytes: number
  hasList: boolean
  properties: Map<string, PlyProperty>
}

export interface PlyHeader {
  format: PlyFormat
  /** Bytes of the header, i.e. the offset of the first row of the first element. */
  headerBytes: number
  elements: PlyElementSpec[]
  vertex: PlyElementSpec
  /** Bytes of fixed-size elements that precede `vertex` and must be skipped. */
  preambleBytes: number
  position: readonly [PlyProperty, PlyProperty, PlyProperty]
  color: readonly [PlyProperty, PlyProperty, PlyProperty] | null
}

/** The file is a valid PLY but not one this fast path handles. */
export class PlyUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlyUnsupportedError'
  }
}

/** The bytes are not a PLY file at all. */
export class PlyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlyFormatError'
  }
}

export interface PointCloudData {
  /** `[x, y, z, …]`, `count * 3` entries. */
  positions: Float32Array
  /** Linear RGB in `[0, 1]`, `count * 3` entries. */
  colors: Float32Array
  /** Points actually kept (after decimation). */
  count: number
  /** Points the file contains. */
  total: number
  /** 1 = every point, n = every n-th point. */
  stride: number
  bbox: { min: [number, number, number]; max: [number, number, number] }
}

/* --------------------------------------------------------------- colour */

/** sRGB [0,1] -> linear [0,1], the transfer function three uses for vertex colours. */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** 256-entry lookup so the hot loop never calls `Math.pow`. */
const SRGB_BYTE_TO_LINEAR = ((): Float32Array => {
  const table = new Float32Array(256)
  for (let i = 0; i < 256; i += 1) table[i] = srgbToLinear(i / 255)
  return table
})()

/* --------------------------------------------------------------- header */

const HEADER_SCAN_LIMIT = 1 << 20 // 1 MiB is far more than any real PLY header
const END_HEADER = [0x65, 0x6e, 0x64, 0x5f, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72] // "end_header"

/**
 * Byte offset just past the newline that ends the header, or `-1` when the buffer does not
 * contain the whole header yet.
 */
export function findHeaderEnd(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, HEADER_SCAN_LIMIT)
  for (let i = 0; i + END_HEADER.length <= limit; i += 1) {
    let hit = true
    for (let j = 0; j < END_HEADER.length; j += 1) {
      if (bytes[i + j] !== END_HEADER[j]) {
        hit = false
        break
      }
    }
    if (!hit) continue
    let k = i + END_HEADER.length
    while (k < bytes.length && bytes[k] !== 0x0a) k += 1
    return k < bytes.length ? k + 1 : -1
  }
  return -1
}

function findTriplet(
  props: Map<string, PlyProperty>,
  names: readonly (readonly [string, string, string])[],
): readonly [PlyProperty, PlyProperty, PlyProperty] | null {
  for (const [a, b, c] of names) {
    const pa = props.get(a)
    const pb = props.get(b)
    const pc = props.get(c)
    if (pa && pb && pc) return [pa, pb, pc] as const
  }
  return null
}

/** Parses the ASCII header. `bytes` must contain at least `end_header\n`. */
export function parsePlyHeader(bytes: Uint8Array): PlyHeader {
  const headerBytes = findHeaderEnd(bytes)
  if (headerBytes < 0) throw new PlyFormatError('Incomplete PLY header')

  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, headerBytes))
  const lines = text.split(/\r?\n/)
  if ((lines[0] ?? '').trim().toLowerCase() !== 'ply') throw new PlyFormatError('Not a PLY file')

  let format: PlyFormat | null = null
  const elements: PlyElementSpec[] = []
  let current: PlyElementSpec | null = null

  for (const raw of lines.slice(1)) {
    const line = raw.trim()
    if (!line || line.startsWith('comment') || line.startsWith('obj_info')) continue
    const parts = line.split(/\s+/)
    const keyword = (parts[0] ?? '').toLowerCase()

    if (keyword === 'format') {
      const f = (parts[1] ?? '').toLowerCase()
      if (f !== 'ascii' && f !== 'binary_little_endian' && f !== 'binary_big_endian') {
        throw new PlyFormatError(`Unknown PLY format "${parts[1] ?? ''}"`)
      }
      format = f
      continue
    }

    if (keyword === 'element') {
      current = {
        name: (parts[1] ?? '').toLowerCase(),
        count: Number.parseInt(parts[2] ?? '0', 10) || 0,
        rowBytes: 0,
        hasList: false,
        properties: new Map<string, PlyProperty>(),
      }
      elements.push(current)
      continue
    }

    if (keyword === 'property') {
      if (!current) continue
      if ((parts[1] ?? '').toLowerCase() === 'list') {
        current.hasList = true
        continue
      }
      const type = SCALAR_ALIASES[(parts[1] ?? '').toLowerCase()]
      const name = (parts[2] ?? '').toLowerCase()
      if (!type || !name) throw new PlyUnsupportedError(`Unsupported property "${line}"`)
      current.properties.set(name, { name, type, offset: current.rowBytes })
      current.rowBytes += SCALAR_BYTES[type]
      continue
    }

    if (keyword === 'end_header') break
  }

  if (!format) throw new PlyFormatError('PLY header has no format line')
  if (format === 'ascii') throw new PlyUnsupportedError('ASCII PLY bodies are handled by PLYLoader')

  const vertexIndex = elements.findIndex((e) => e.name === 'vertex')
  const vertex = vertexIndex >= 0 ? elements[vertexIndex] : undefined
  if (!vertex) throw new PlyFormatError('PLY header has no vertex element')
  if (vertex.hasList) throw new PlyUnsupportedError('Vertex element has a list property')

  let preambleBytes = 0
  for (let i = 0; i < vertexIndex; i += 1) {
    const e = elements[i]
    if (e.hasList) throw new PlyUnsupportedError('List property before the vertex element')
    preambleBytes += e.rowBytes * e.count
  }

  const position = findTriplet(vertex.properties, [['x', 'y', 'z']])
  if (!position) throw new PlyFormatError('Vertex element has no x/y/z properties')

  const color = findTriplet(vertex.properties, [
    ['red', 'green', 'blue'],
    ['diffuse_red', 'diffuse_green', 'diffuse_blue'],
    ['r', 'g', 'b'],
  ])

  return { format, headerBytes, elements, vertex, preambleBytes, position, color }
}

/* ---------------------------------------------------------------- reading */

function readScalar(view: DataView, offset: number, type: PlyScalar, littleEndian: boolean): number {
  switch (type) {
    case 'int8':
      return view.getInt8(offset)
    case 'uint8':
      return view.getUint8(offset)
    case 'int16':
      return view.getInt16(offset, littleEndian)
    case 'uint16':
      return view.getUint16(offset, littleEndian)
    case 'int32':
      return view.getInt32(offset, littleEndian)
    case 'uint32':
      return view.getUint32(offset, littleEndian)
    case 'float32':
      return view.getFloat32(offset, littleEndian)
    case 'float64':
      return view.getFloat64(offset, littleEndian)
    default:
      return 0
  }
}

/** One colour channel as a linear float, whatever integer or float type the file used. */
function readChannel(view: DataView, offset: number, type: PlyScalar, littleEndian: boolean): number {
  if (type === 'uint8') return SRGB_BYTE_TO_LINEAR[view.getUint8(offset)] ?? 0
  const raw = readScalar(view, offset, type, littleEndian)
  const normalized =
    type === 'uint16' ? raw / 65535 : type === 'uint32' ? raw / 4294967295 : Math.min(1, Math.max(0, raw))
  return srgbToLinear(normalized)
}

/** `1` keeps every point; `n` keeps every n-th so that at most `maxPoints` survive. */
export function strideForBudget(total: number, maxPoints: number): number {
  if (!Number.isFinite(total) || total <= 0 || maxPoints <= 0) return 1
  return total > maxPoints ? Math.ceil(total / maxPoints) : 1
}

/* ---------------------------------------------------------------- parser */

/**
 * Feed it `push(chunk)` in arrival order, then call `finish()`. Decimation, the bounding box
 * and the sRGB conversion all happen inside the single pass over the bytes.
 */
export class PlyPointParser {
  readonly header: PlyHeader
  readonly total: number
  readonly stride: number
  readonly capacity: number
  readonly positions: Float32Array
  readonly colors: Float32Array

  private readonly littleEndian: boolean
  private readonly rowBytes: number
  private readonly min: [number, number, number] = [Infinity, Infinity, Infinity]
  private readonly max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  private index = 0
  private kept = 0
  private skipRemaining: number
  private leftover: Uint8Array | null = null

  constructor(header: PlyHeader, maxPoints: number) {
    this.header = header
    this.total = header.vertex.count
    this.stride = strideForBudget(this.total, maxPoints)
    this.capacity = this.total > 0 ? Math.floor((this.total - 1) / this.stride) + 1 : 0
    this.positions = new Float32Array(this.capacity * 3)
    this.colors = new Float32Array(this.capacity * 3)
    this.littleEndian = header.format === 'binary_little_endian'
    this.rowBytes = header.vertex.rowBytes
    this.skipRemaining = header.preambleBytes
  }

  /** Vertices whose bytes have been read (including the decimated-away ones). */
  get parsed(): number {
    return this.index
  }

  /** Vertices stored in {@link positions}. */
  get points(): number {
    return this.kept
  }

  get complete(): boolean {
    return this.index >= this.total
  }

  /** Bytes of the vertex block, so callers can show progress without a Content-Length. */
  get bodyBytes(): number {
    return this.header.preambleBytes + this.total * this.rowBytes
  }

  push(chunk: Uint8Array): void {
    if (this.complete || chunk.length === 0) return

    let buf: Uint8Array
    const leftover = this.leftover
    if (leftover && leftover.length > 0) {
      buf = new Uint8Array(leftover.length + chunk.length)
      buf.set(leftover, 0)
      buf.set(chunk, leftover.length)
      this.leftover = null
    } else {
      buf = chunk
    }

    let offset = 0
    if (this.skipRemaining > 0) {
      const skipped = Math.min(this.skipRemaining, buf.length)
      offset += skipped
      this.skipRemaining -= skipped
      if (this.skipRemaining > 0) return
    }

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const rowBytes = this.rowBytes
    while (this.index < this.total && buf.length - offset >= rowBytes) {
      this.readVertex(view, offset)
      offset += rowBytes
      this.index += 1
    }

    this.leftover = offset < buf.length && !this.complete ? buf.slice(offset) : null
  }

  private readVertex(view: DataView, base: number): void {
    if (this.index % this.stride !== 0 || this.kept >= this.capacity) return
    const le = this.littleEndian
    const [px, py, pz] = this.header.position
    const x = readScalar(view, base + px.offset, px.type, le)
    const y = readScalar(view, base + py.offset, py.type, le)
    const z = readScalar(view, base + pz.offset, pz.type, le)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return

    const k = this.kept * 3
    this.positions[k] = x
    this.positions[k + 1] = y
    this.positions[k + 2] = z

    if (x < this.min[0]) this.min[0] = x
    if (y < this.min[1]) this.min[1] = y
    if (z < this.min[2]) this.min[2] = z
    if (x > this.max[0]) this.max[0] = x
    if (y > this.max[1]) this.max[1] = y
    if (z > this.max[2]) this.max[2] = z

    const color = this.header.color
    if (color) {
      this.colors[k] = readChannel(view, base + color[0].offset, color[0].type, le)
      this.colors[k + 1] = readChannel(view, base + color[1].offset, color[1].type, le)
      this.colors[k + 2] = readChannel(view, base + color[2].offset, color[2].type, le)
    }

    this.kept += 1
  }

  /** Trims the buffers and, for colourless clouds, paints a height ramp so the shape reads. */
  finish(): PointCloudData {
    const count = this.kept
    const used = count * 3
    const positions = used === this.positions.length ? this.positions : this.positions.slice(0, used)
    let colors = used === this.colors.length ? this.colors : this.colors.slice(0, used)

    const empty = count === 0 || !Number.isFinite(this.min[0])
    const bbox = empty
      ? { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] }
      : { min: [...this.min] as [number, number, number], max: [...this.max] as [number, number, number] }

    if (!this.header.color && count > 0) colors = heightRamp(positions, count, bbox.min[1], bbox.max[1])

    return { positions, colors, count, total: this.total, stride: this.stride, bbox }
  }
}

/** Deep blue -> ghost blue -> white by height; only used when the file carries no colours. */
export function heightRamp(positions: Float32Array, count: number, minY: number, maxY: number): Float32Array {
  const colors = new Float32Array(count * 3)
  const span = maxY - minY || 1
  for (let i = 0; i < count; i += 1) {
    const t = Math.min(1, Math.max(0, (positions[i * 3 + 1] - minY) / span))
    const k = i * 3
    if (t < 0.5) {
      const u = t * 2
      colors[k] = 0.02 + u * 0.03
      colors[k + 1] = 0.06 + u * 0.2
      colors[k + 2] = 0.18 + u * 0.42
    } else {
      const u = (t - 0.5) * 2
      colors[k] = 0.05 + u * 0.75
      colors[k + 1] = 0.26 + u * 0.65
      colors[k + 2] = 0.6 + u * 0.4
    }
  }
  return colors
}

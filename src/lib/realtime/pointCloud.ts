/**
 * Growable geometry buffers for the live party viewer (PLAN section 4).
 *
 * Deliberately free of three.js: these own plain `Float32Array`s that the renderer wraps in
 * `BufferAttribute`s, which keeps the whole realtime layer out of the three.js chunk and makes
 * the ingest path unit-testable. Capacity grows in chunks (doubling up to 1 M points, then a
 * fixed 256 k step), so a keyframe arriving at 3 Hz never reallocates: the renderer only has to
 * rebuild its attributes when {@link PointCloudBuffer.generation} changes.
 */

export type Rgb = readonly [number, number, number]

/** 32 k points (~768 KB of position + colour data) is one or two keyframes' worth of headroom. */
const INITIAL_CAPACITY = 1 << 15
/** Beyond a million points, doubling wastes too much memory; step by this instead. */
const DOUBLE_UNTIL = 1 << 20
const CHUNK = 1 << 18

function nextCapacity(current: number, needed: number): number {
  let capacity = Math.max(current, 1)
  while (capacity < needed) capacity = capacity < DOUBLE_UNTIL ? capacity * 2 : capacity + CHUNK
  return capacity
}

/**
 * sRGB 0..255 to three.js's linear working space, as a lookup table: the conversion runs once
 * per possible byte instead of once per point. three assumes vertex colours are already linear
 * (it only converts colours set from CSS/hex strings), so writing raw 0..1 sRGB into the buffer
 * is what makes an untreated cloud look washed out.
 */
const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i += 1) {
  const c = i / 255
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function srgbToLinear(c: number): number {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** `#38bdf8` (or `38bdf8`) to normalized sRGB. Anything unparseable yields `fallback`. */
export function hexToRgb(hex: string | null | undefined, fallback: Rgb = [0.6, 0.75, 0.9]): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m?.[1]) return fallback
  const n = Number.parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Positions + per-point colours for one device's cloud.
 *
 * `generation` counts reallocations (the renderer must rebuild its attributes), `revision`
 * counts content changes (the renderer only has to flag `needsUpdate` and move the draw range).
 */
export class PointCloudBuffer {
  positions: Float32Array
  colors: Float32Array
  /** Points currently in the buffer; the draw range is `[0, count)`. */
  count = 0
  capacity: number
  generation = 0
  revision = 0

  constructor(initialCapacity: number = INITIAL_CAPACITY) {
    this.capacity = Math.max(1, initialCapacity)
    this.positions = new Float32Array(this.capacity * 3)
    this.colors = new Float32Array(this.capacity * 3)
  }

  private reserve(extraPoints: number): void {
    const needed = this.count + extraPoints
    if (needed <= this.capacity) return
    const capacity = nextCapacity(this.capacity, needed)
    const positions = new Float32Array(capacity * 3)
    const colors = new Float32Array(capacity * 3)
    positions.set(this.positions.subarray(0, this.count * 3))
    colors.set(this.colors.subarray(0, this.count * 3))
    this.positions = positions
    this.colors = colors
    this.capacity = capacity
    this.generation += 1
  }

  /**
   * Appends a `points_inline` payload: a flat `[x, y, z, r, g, b, ...]` array whose colour
   * components are 0..255 (PLAN section 2).
   *
   * Each point's own colour is blended toward `tint` (the participant's party colour) by
   * `tintWeight`, then scaled by `brightness` — that is what makes every device's cloud
   * recognisable while keeping the captured RGB, and what greys out unaligned keyframes.
   *
   * Returns the number of points actually appended.
   */
  appendInline(
    flat: ArrayLike<number> | null | undefined,
    tint: Rgb,
    tintWeight = 0.45,
    brightness = 1,
  ): number {
    if (!flat) return 0
    const points = Math.floor(flat.length / 6)
    if (points <= 0) return 0
    this.reserve(points)

    const { positions, colors } = this
    const w = Math.min(1, Math.max(0, tintWeight))
    const keep = 1 - w
    // Blend in the linear working space, converting the tint once rather than per point.
    const tr = srgbToLinear(tint[0]) * w
    const tg = srgbToLinear(tint[1]) * w
    const tb = srgbToLinear(tint[2]) * w
    let write = this.count * 3
    let appended = 0

    for (let i = 0; i < points; i += 1) {
      const src = i * 6
      const x = flat[src] as number
      const y = flat[src + 1] as number
      const z = flat[src + 2] as number
      // A NaN or Infinity in a pose-transformed point would poison the bounding sphere.
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
      positions[write] = x
      positions[write + 1] = y
      positions[write + 2] = z
      const r = SRGB_TO_LINEAR[byte(flat[src + 3])] as number
      const g = SRGB_TO_LINEAR[byte(flat[src + 4])] as number
      const b = SRGB_TO_LINEAR[byte(flat[src + 5])] as number
      colors[write] = (r * keep + tr) * brightness
      colors[write + 1] = (g * keep + tg) * brightness
      colors[write + 2] = (b * keep + tb) * brightness
      write += 3
      appended += 1
    }

    this.count += appended
    if (appended) this.revision += 1
    return appended
  }

  /**
   * Halves the oldest half of the cloud in place: keeps every second point up to the midpoint
   * and slides the newer half down. Roughly a 25 % reduction per pass, and unlike dropping the
   * head outright it keeps the start of the room on screen — the point of a *decimation*
   * budget rather than a sliding window. Returns how many points were removed.
   */
  decimateOldest(): number {
    const half = this.count >> 1
    if (half < 2) return 0
    const { positions, colors } = this
    let write = 0
    for (let read = 0; read < half; read += 2) {
      const from = read * 3
      const to = write * 3
      positions[to] = positions[from] as number
      positions[to + 1] = positions[from + 1] as number
      positions[to + 2] = positions[from + 2] as number
      colors[to] = colors[from] as number
      colors[to + 1] = colors[from + 1] as number
      colors[to + 2] = colors[from + 2] as number
      write += 1
    }
    const tail = this.count - half
    positions.copyWithin(write * 3, half * 3, this.count * 3)
    colors.copyWithin(write * 3, half * 3, this.count * 3)
    const removed = this.count - (write + tail)
    this.count = write + tail
    this.revision += 1
    return removed
  }

  clear(): void {
    this.count = 0
    this.revision += 1
  }
}

/** `points_inline` colour components are 0..255; clamp and round whatever actually arrives. */
function byte(value: number | undefined): number {
  const n = Math.round(Number(value) || 0)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

/** Positions only, for a device's trajectory polyline (one vertex per keyframe pose). */
export class TrajectoryBuffer {
  positions: Float32Array
  count = 0
  capacity: number
  generation = 0
  revision = 0

  constructor(initialCapacity = 1024) {
    this.capacity = Math.max(1, initialCapacity)
    this.positions = new Float32Array(this.capacity * 3)
  }

  push(x: number, y: number, z: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false
    if (this.count + 1 > this.capacity) {
      const capacity = nextCapacity(this.capacity, this.count + 1)
      const positions = new Float32Array(capacity * 3)
      positions.set(this.positions.subarray(0, this.count * 3))
      this.positions = positions
      this.capacity = capacity
      this.generation += 1
    }
    const at = this.count * 3
    this.positions[at] = x
    this.positions[at + 1] = y
    this.positions[at + 2] = z
    this.count += 1
    this.revision += 1
    return true
  }
}

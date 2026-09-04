/**
 * The mutable model behind the live party view (PLAN sections 2 and 4).
 *
 * Keyframes arrive from two places — the REST catch-up loop and the Ably `keyframes` event —
 * and both land here. React never re-renders per message: the store is a plain object held in
 * a ref, the 3D scene reads its buffers every frame, and the panels poll {@link LiveStore.stats}
 * a few times a second. Everything is deduplicated on `(device_id, seq)`, so replaying the
 * catch-up loop after a reconnect (or an Ably rewind) is always safe.
 */
import type { Keyframe, PoseMessage } from '../api/types'
import { PointCloudBuffer, TrajectoryBuffer, hexToRgb, type Rgb } from './pointCloud'

/** PLAN section 4: keep at most 2 M points on screen, decimating the oldest beyond that. */
export const MAX_POINTS = 2_000_000

/** How strongly a device's party colour tints its per-point RGB. */
const TINT_WEIGHT = 0.42
/** Keyframes a device captured before it saw the marker are greyed out (PLAN section 2). */
const UNALIGNED_TINT: Rgb = [0.55, 0.57, 0.6]
const UNALIGNED_TINT_WEIGHT = 0.85
const UNALIGNED_BRIGHTNESS = 0.7

export interface DeviceLayer {
  deviceId: string
  /** Party colour from the participant row or the `keyframes` message. */
  color: string
  tint: Rgb
  points: PointCloudBuffer
  trajectory: TrajectoryBuffer
  /** Latest 4x4 column-major pose, from a `pose` message or the newest keyframe. */
  latestPose: Float32Array | null
  latestPoseAligned: boolean
  /** `performance.now()` of the latest pose, for the "live" dot. */
  latestPoseAt: number
  keyframeCount: number
  unalignedKeyframes: number
  pointCount: number
  maxSeq: number
  lastSeenAt: number
}

export interface DeviceStat {
  deviceId: string
  color: string
  keyframes: number
  points: number
  unaligned: number
  /** Seconds since the last pose or keyframe, or `null` when nothing has arrived. */
  ageS: number | null
}

export interface LiveStats {
  keyframes: number
  points: number
  droppedPoints: number
  devices: DeviceStat[]
  messagesPerSecond: number
  /** Highest keyframe row id seen from REST; the resume point after a reconnect. */
  lastKeyframeId: number
  /** Bumped when a device layer appears or changes colour, so the scene rebuilds its objects. */
  structureVersion: number
}

const EMPTY_STATS: LiveStats = {
  keyframes: 0,
  points: 0,
  droppedPoints: 0,
  devices: [],
  messagesPerSecond: 0,
  lastKeyframeId: 0,
  structureVersion: 0,
}

export function emptyStats(): LiveStats {
  return EMPTY_STATS
}

/** Axis-aligned bounds of the aligned data, used to frame the camera. */
export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
  valid: boolean
}

export class LiveStore {
  readonly layers = new Map<string, DeviceLayer>()
  structureVersion = 0
  totalKeyframes = 0
  totalPoints = 0
  droppedPoints = 0
  lastKeyframeId = 0
  /** Bumped on every visible change, so a paused scene knows it has work waiting. */
  dataVersion = 0

  private readonly bounds: Bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    valid: false,
  }

  private colorFor: (deviceId: string) => string = () => ''
  private messagesInWindow = 0
  private windowStartedAt = 0
  private rate = 0

  /** Participant colours are known before catch-up runs, so points get the right tint at once. */
  setColorResolver(resolve: (deviceId: string) => string): void {
    this.colorFor = resolve
    for (const layer of this.layers.values()) {
      const next = resolve(layer.deviceId)
      if (next && next !== layer.color) {
        layer.color = next
        layer.tint = hexToRgb(next, layer.tint)
        this.structureVersion += 1
      }
    }
  }

  layer(deviceId: string, color?: string | null): DeviceLayer {
    const key = deviceId || 'unknown'
    const existing = this.layers.get(key)
    if (existing) {
      if (color && color !== existing.color) {
        existing.color = color
        existing.tint = hexToRgb(color, existing.tint)
        this.structureVersion += 1
      }
      return existing
    }
    const resolved = color || this.colorFor(key) || ''
    const created: DeviceLayer = {
      deviceId: key,
      color: resolved,
      tint: hexToRgb(resolved),
      points: new PointCloudBuffer(),
      trajectory: new TrajectoryBuffer(),
      latestPose: null,
      latestPoseAligned: true,
      latestPoseAt: 0,
      keyframeCount: 0,
      unalignedKeyframes: 0,
      pointCount: 0,
      maxSeq: -1,
      lastSeenAt: 0,
    }
    this.layers.set(key, created)
    this.structureVersion += 1
    return created
  }

  /** Counts a realtime message for the messages/second readout. */
  noteMessage(): void {
    this.messagesInWindow += 1
  }

  /**
   * Appends keyframes for one device. `deviceId`/`color` come from the Ably envelope; the REST
   * rows carry their own `deviceId`, so pass none and each row is routed by itself.
   */
  ingestKeyframes(keyframes: readonly Keyframe[], envelope?: { deviceId?: string | null; color?: string | null }): number {
    let accepted = 0
    for (const kf of keyframes) {
      const deviceId = kf.deviceId || envelope?.deviceId || 'unknown'
      const layer = this.layer(deviceId, envelope?.color ?? null)
      const seq = Number(kf.seq ?? 0)
      // Per-device sequence numbers are monotonic, so this drops catch-up/rewind overlap.
      if (Number.isFinite(seq) && seq <= layer.maxSeq) continue
      if (Number.isFinite(seq)) layer.maxSeq = seq

      const id = Number(kf.id ?? 0)
      if (Number.isFinite(id) && id > this.lastKeyframeId) this.lastKeyframeId = id

      const aligned = kf.aligned !== false
      const pose = kf.pose
      if (Array.isArray(pose) && pose.length >= 16) {
        const m = Float32Array.from(pose)
        layer.latestPose = m
        layer.latestPoseAligned = aligned
        layer.latestPoseAt = now()
        // Column-major: the translation is the fourth column. An unaligned pose is expressed in
        // the device's own frame, so it would kink the trajectory — show its points, not its path.
        if (aligned) {
          const added = layer.trajectory.push(m[12] as number, m[13] as number, m[14] as number)
          if (added) this.expandBounds(m[12] as number, m[13] as number, m[14] as number)
        }
      }

      const appended = aligned
        ? layer.points.appendInline(kf.pointsInline, layer.tint, TINT_WEIGHT)
        : layer.points.appendInline(kf.pointsInline, UNALIGNED_TINT, UNALIGNED_TINT_WEIGHT, UNALIGNED_BRIGHTNESS)
      if (appended && aligned) this.expandBoundsFrom(kf.pointsInline)

      layer.pointCount += appended
      layer.keyframeCount += 1
      if (!aligned) layer.unalignedKeyframes += 1
      layer.lastSeenAt = now()
      this.totalPoints += appended
      this.totalKeyframes += 1
      accepted += 1
    }
    if (accepted) {
      this.enforceBudget()
      this.dataVersion += 1
    }
    return accepted
  }

  /** A device's `pose` message (≤ 10 Hz): moves its frustum, never grows the cloud. */
  ingestPose(msg: PoseMessage): void {
    const deviceId = msg.deviceId || 'unknown'
    const pose = msg.pose
    if (!Array.isArray(pose) || pose.length < 16) return
    const layer = this.layer(deviceId)
    layer.latestPose = Float32Array.from(pose)
    layer.latestPoseAligned = msg.aligned !== false
    layer.latestPoseAt = now()
    layer.lastSeenAt = layer.latestPoseAt
    this.dataVersion += 1
  }

  /** Drops the oldest points, device by device, until the scene is back inside the budget. */
  private enforceBudget(): void {
    let guard = 0
    while (this.totalPoints > MAX_POINTS && guard < 64) {
      guard += 1
      let biggest: DeviceLayer | null = null
      for (const layer of this.layers.values()) {
        if (!biggest || layer.points.count > biggest.points.count) biggest = layer
      }
      if (!biggest) return
      const removed = biggest.points.decimateOldest()
      if (removed <= 0) return
      biggest.pointCount = biggest.points.count
      this.totalPoints -= removed
      this.droppedPoints += removed
    }
  }

  private expandBounds(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    const { min, max } = this.bounds
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
    this.bounds.valid = true
  }

  /** Samples one point in sixteen: enough to frame the camera, cheap enough to run per keyframe. */
  private expandBoundsFrom(flat: ArrayLike<number> | null | undefined): void {
    if (!flat) return
    const points = Math.floor(flat.length / 6)
    for (let i = 0; i < points; i += 16) {
      const at = i * 6
      this.expandBounds(flat[at] as number, flat[at + 1] as number, flat[at + 2] as number)
    }
  }

  /** Cheap check before the allocating {@link currentBounds}, for per-frame callers. */
  get hasBounds(): boolean {
    return this.bounds.valid
  }

  /** Copy of the current bounds; `valid` is false until something aligned has arrived. */
  currentBounds(): Bounds {
    return { min: [...this.bounds.min] as [number, number, number], max: [...this.bounds.max] as [number, number, number], valid: this.bounds.valid }
  }

  /** Snapshot for the React panels. Called a few times a second, never per message. */
  stats(): LiveStats {
    const t = now()
    if (!this.windowStartedAt) this.windowStartedAt = t
    const elapsed = t - this.windowStartedAt
    if (elapsed >= 1000) {
      const instant = (this.messagesInWindow * 1000) / elapsed
      this.rate = this.rate === 0 ? instant : this.rate * 0.5 + instant * 0.5
      this.messagesInWindow = 0
      this.windowStartedAt = t
    }
    const devices: DeviceStat[] = []
    for (const layer of this.layers.values()) {
      devices.push({
        deviceId: layer.deviceId,
        color: layer.color,
        keyframes: layer.keyframeCount,
        points: layer.points.count,
        unaligned: layer.unalignedKeyframes,
        ageS: layer.lastSeenAt ? (t - layer.lastSeenAt) / 1000 : null,
      })
    }
    devices.sort((a, b) => b.points - a.points)
    return {
      keyframes: this.totalKeyframes,
      points: this.totalPoints,
      droppedPoints: this.droppedPoints,
      devices,
      messagesPerSecond: Math.round(this.rate * 10) / 10,
      lastKeyframeId: this.lastKeyframeId,
      structureVersion: this.structureVersion,
    }
  }

  reset(): void {
    this.layers.clear()
    this.structureVersion += 1
    this.totalKeyframes = 0
    this.totalPoints = 0
    this.droppedPoints = 0
    this.lastKeyframeId = 0
    this.dataVersion += 1
    this.bounds.min = [Infinity, Infinity, Infinity]
    this.bounds.max = [-Infinity, -Infinity, -Infinity]
    this.bounds.valid = false
    this.messagesInWindow = 0
    this.windowStartedAt = 0
    this.rate = 0
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

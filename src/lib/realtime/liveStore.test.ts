/**
 * The ingest path behind the live party view: chunked growth, deduplication across the REST
 * catch-up and the Ably stream, the per-device colour tint, greyed-out unaligned keyframes and
 * the 2 M point budget. These are the behaviours the 3D scene assumes are already true.
 */
import { describe, expect, it } from 'vitest'
import { PointCloudBuffer, hexToRgb } from './pointCloud'
import { LiveStore } from './liveStore'
import { keyframeSchema, type Keyframe } from '../api/types'

/** A keyframe with a pose at `(x, y, z)` and `points` inline points, all white. */
function keyframe(partial: {
  id?: number
  deviceId?: string
  seq: number
  at?: [number, number, number]
  points?: number
  aligned?: boolean
}): Keyframe {
  const [x, y, z] = partial.at ?? [0, 0, 0]
  const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
  const inline: number[] = []
  for (let i = 0; i < (partial.points ?? 0); i += 1) inline.push(i * 0.01, 0.5, -1, 255, 255, 255)
  return keyframeSchema.parse({
    id: partial.id ?? partial.seq + 1,
    device_id: partial.deviceId ?? 'phone-a',
    seq: partial.seq,
    t: partial.seq / 3,
    pose,
    aligned: partial.aligned ?? true,
    points_inline: inline,
  })
}

describe('hexToRgb', () => {
  it('parses a palette colour and falls back on junk', () => {
    expect(hexToRgb('#38bdf8')).toEqual([0x38 / 255, 0xbd / 255, 0xf8 / 255])
    expect(hexToRgb('38bdf8')).toEqual([0x38 / 255, 0xbd / 255, 0xf8 / 255])
    expect(hexToRgb('nope', [1, 0, 0])).toEqual([1, 0, 0])
    expect(hexToRgb(null, [1, 0, 0])).toEqual([1, 0, 0])
  })
})

describe('PointCloudBuffer', () => {
  it('grows in chunks instead of reallocating per append', () => {
    const buffer = new PointCloudBuffer(4)
    const flat = [0, 0, 0, 255, 255, 255, 1, 1, 1, 0, 0, 0]
    buffer.appendInline(flat, [0, 0, 1], 0)
    expect(buffer.count).toBe(2)
    expect(buffer.generation).toBe(0)

    buffer.appendInline(flat, [0, 0, 1], 0)
    expect(buffer.count).toBe(4)
    expect(buffer.generation).toBe(0) // still inside the initial capacity

    buffer.appendInline(flat, [0, 0, 1], 0)
    expect(buffer.count).toBe(6)
    expect(buffer.generation).toBe(1) // one growth covered both new points
    expect(buffer.capacity).toBeGreaterThanOrEqual(6)
    expect(buffer.positions[3]).toBe(1)
  })

  it('blends the per-point RGB toward the device tint, in linear space', () => {
    const buffer = new PointCloudBuffer(2)
    buffer.appendInline([0, 0, 0, 0, 0, 0], [1, 0, 0], 0.5)
    expect(buffer.colors[0]).toBeCloseTo(0.5)
    expect(buffer.colors[1]).toBeCloseTo(0)

    // three.js treats vertex colours as linear, so a mid-grey byte must land at ~0.216, not 0.5.
    const untinted = new PointCloudBuffer(2)
    untinted.appendInline([0, 0, 0, 255, 128, 0], [0, 0, 1], 0)
    expect(untinted.colors[0]).toBeCloseTo(1)
    expect(untinted.colors[1]).toBeCloseTo(0.2158, 3)
  })

  it('clamps colour components that are out of range', () => {
    const buffer = new PointCloudBuffer(2)
    buffer.appendInline([0, 0, 0, 999, -20, 255], [0, 0, 0], 0)
    expect(buffer.colors[0]).toBeCloseTo(1)
    expect(buffer.colors[1]).toBeCloseTo(0)
    expect(buffer.colors[2]).toBeCloseTo(1)
  })

  it('skips points with a non-finite coordinate', () => {
    const buffer = new PointCloudBuffer(4)
    const appended = buffer.appendInline([Number.NaN, 0, 0, 255, 255, 255, 1, 2, 3, 255, 0, 0], [0, 0, 0], 0)
    expect(appended).toBe(1)
    expect(buffer.count).toBe(1)
    expect(buffer.positions[0]).toBe(1)
  })

  it('decimates the oldest half and keeps the newest points intact', () => {
    const buffer = new PointCloudBuffer(16)
    const flat: number[] = []
    for (let i = 0; i < 8; i += 1) flat.push(i, 0, 0, 0, 0, 0)
    buffer.appendInline(flat, [0, 0, 0], 0)
    expect(buffer.count).toBe(8)

    const removed = buffer.decimateOldest()
    expect(removed).toBe(2) // the oldest four become two
    expect(buffer.count).toBe(6)
    expect(Array.from(buffer.positions.slice(0, 18)).filter((_v, i) => i % 3 === 0)).toEqual([0, 2, 4, 5, 6, 7])
  })
})

describe('LiveStore', () => {
  it('routes keyframes into per-device layers and counts points', () => {
    const store = new LiveStore()
    store.ingestKeyframes([keyframe({ seq: 0, points: 3 }), keyframe({ deviceId: 'phone-b', seq: 0, points: 2 })])
    expect(store.layers.size).toBe(2)
    expect(store.totalKeyframes).toBe(2)
    expect(store.totalPoints).toBe(5)
    expect(store.layers.get('phone-a')?.points.count).toBe(3)
    expect(store.layers.get('phone-b')?.points.count).toBe(2)
  })

  it('drops a keyframe already seen, so catch-up and the socket can overlap', () => {
    const store = new LiveStore()
    const rows = [keyframe({ seq: 0, points: 2 }), keyframe({ seq: 1, points: 2 })]
    expect(store.ingestKeyframes(rows)).toBe(2)
    // The same rows arriving again over Ably (or after a reconnect) change nothing.
    expect(store.ingestKeyframes(rows)).toBe(0)
    expect(store.totalPoints).toBe(4)
    expect(store.ingestKeyframes([keyframe({ seq: 2, points: 2 })])).toBe(1)
    expect(store.totalPoints).toBe(6)
  })

  it('tracks the highest keyframe id as the resume point after a reconnect', () => {
    const store = new LiveStore()
    store.ingestKeyframes([keyframe({ id: 7, seq: 0 }), keyframe({ id: 41, seq: 1 })])
    expect(store.lastKeyframeId).toBe(41)
  })

  it('builds a trajectory from aligned poses only', () => {
    const store = new LiveStore()
    store.ingestKeyframes([
      keyframe({ seq: 0, at: [0, 0, 0] }),
      keyframe({ seq: 1, at: [1, 0, 0], aligned: false }),
      keyframe({ seq: 2, at: [2, 0, 0] }),
    ])
    const layer = store.layers.get('phone-a')
    expect(layer?.trajectory.count).toBe(2)
    expect(layer?.trajectory.positions[3]).toBe(2)
    expect(layer?.unalignedKeyframes).toBe(1)
  })

  it('greys unaligned points and tints aligned ones with the party colour', () => {
    const store = new LiveStore()
    store.setColorResolver(() => '#ff0000')
    store.ingestKeyframes([keyframe({ seq: 0, points: 1 })])
    store.ingestKeyframes([keyframe({ seq: 1, points: 1, aligned: false })])
    const colors = store.layers.get('phone-a')?.points.colors as Float32Array
    // Aligned: white blended toward pure red, so red stays the strongest channel.
    expect(colors[0]).toBeGreaterThan(colors[1] as number)
    // Unaligned: heavily greyed, so the three channels are within a hair of each other.
    expect(Math.abs((colors[3] as number) - (colors[4] as number))).toBeLessThan(0.02)
    expect(colors[3]).toBeLessThan(0.9)
  })

  it('applies a late colour to a device that already has a layer', () => {
    const store = new LiveStore()
    store.ingestKeyframes([keyframe({ seq: 0, points: 1 })])
    const before = store.layers.get('phone-a')?.color
    store.setColorResolver(() => '#4ade80')
    expect(before).not.toBe('#4ade80')
    expect(store.layers.get('phone-a')?.color).toBe('#4ade80')
  })

  it('takes the pose from a pose message without growing the cloud', () => {
    const store = new LiveStore()
    store.ingestKeyframes([keyframe({ seq: 0, points: 2 })])
    store.ingestPose({ deviceId: 'phone-a', t: 1, pose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1], aligned: true })
    const layer = store.layers.get('phone-a')
    expect(layer?.latestPose?.[12]).toBe(5)
    expect(layer?.points.count).toBe(2)
    expect(layer?.trajectory.count).toBe(1)
  })

  it('reports per-device stats sorted by size', () => {
    const store = new LiveStore()
    store.ingestKeyframes([keyframe({ seq: 0, points: 1 }), keyframe({ deviceId: 'phone-b', seq: 0, points: 4 })])
    const stats = store.stats()
    expect(stats.devices.map((d) => d.deviceId)).toEqual(['phone-b', 'phone-a'])
    expect(stats.keyframes).toBe(2)
    expect(stats.points).toBe(5)
  })

  it('forgets everything when the party changes', () => {
    const store = new LiveStore()
    store.ingestKeyframes([keyframe({ seq: 0, points: 2 })])
    store.reset()
    expect(store.layers.size).toBe(0)
    expect(store.totalPoints).toBe(0)
    expect(store.lastKeyframeId).toBe(0)
    expect(store.hasBounds).toBe(false)
  })
})

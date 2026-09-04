/**
 * The PLY fast path: the exact layout the Ghostmap app writes (binary little-endian,
 * float x/y/z + uchar red/green/blue), fed through the parser in awkward chunk sizes so the
 * cross-chunk vertex boundaries are exercised the way a real network stream exercises them.
 */
import { describe, expect, it } from 'vitest'
import {
  PlyPointParser,
  PlyUnsupportedError,
  findHeaderEnd,
  parsePlyHeader,
  srgbToLinear,
  strideForBudget,
} from './ply'

interface TestPoint {
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
}

const ROW_BYTES = 4 * 3 + 3

function buildBinaryPly(points: TestPoint[], withColor = true): Uint8Array {
  const properties = withColor
    ? 'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n'
    : 'property float x\nproperty float y\nproperty float z\n'
  const header =
    `ply\nformat binary_little_endian 1.0\ncomment ghostmap test\nelement vertex ${points.length}\n` +
    `${properties}end_header\n`
  const headerBytes = new TextEncoder().encode(header)
  const rowBytes = withColor ? ROW_BYTES : 12
  const out = new Uint8Array(headerBytes.length + points.length * rowBytes)
  out.set(headerBytes, 0)
  const view = new DataView(out.buffer, headerBytes.length)
  points.forEach((point, index) => {
    const base = index * rowBytes
    view.setFloat32(base, point.x, true)
    view.setFloat32(base + 4, point.y, true)
    view.setFloat32(base + 8, point.z, true)
    if (withColor) {
      view.setUint8(base + 12, point.r)
      view.setUint8(base + 13, point.g)
      view.setUint8(base + 14, point.b)
    }
  })
  return out
}

function samplePoints(count: number): TestPoint[] {
  return Array.from({ length: count }, (_unused, i) => ({
    x: i,
    y: i * 0.5,
    z: -i,
    r: (i * 25) % 256,
    g: (i * 7) % 256,
    b: 255 - ((i * 3) % 256),
  }))
}

/** Pushes the body through the parser in fixed-size slices, like a streamed response. */
function feed(parser: PlyPointParser, body: Uint8Array, chunkSize: number): void {
  for (let offset = 0; offset < body.length; offset += chunkSize) {
    parser.push(body.subarray(offset, Math.min(body.length, offset + chunkSize)))
  }
}

describe('parsePlyHeader', () => {
  it('reads the layout the app writes', () => {
    const file = buildBinaryPly(samplePoints(4))
    const header = parsePlyHeader(file)
    expect(header.format).toBe('binary_little_endian')
    expect(header.vertex.count).toBe(4)
    expect(header.vertex.rowBytes).toBe(ROW_BYTES)
    expect(header.preambleBytes).toBe(0)
    expect(header.position.map((p) => p.offset)).toEqual([0, 4, 8])
    expect(header.color?.map((p) => p.offset)).toEqual([12, 13, 14])
  })

  it('waits for the whole header before committing', () => {
    const file = buildBinaryPly(samplePoints(2))
    expect(findHeaderEnd(file.subarray(0, 20))).toBe(-1)
    expect(findHeaderEnd(file)).toBeGreaterThan(20)
  })

  it('hands ASCII bodies to the PLYLoader fallback', () => {
    const ascii = new TextEncoder().encode(
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n',
    )
    expect(() => parsePlyHeader(ascii)).toThrow(PlyUnsupportedError)
  })
})

describe('PlyPointParser', () => {
  it('parses every point, colour and bound across chunk boundaries', () => {
    const points = samplePoints(10)
    const file = buildBinaryPly(points)
    const header = parsePlyHeader(file)
    const parser = new PlyPointParser(header, 1_000_000)
    // 7 bytes never lines up with the 15-byte rows, so every leftover path is used.
    feed(parser, file.subarray(header.headerBytes), 7)

    expect(parser.complete).toBe(true)
    const cloud = parser.finish()
    expect(cloud.count).toBe(10)
    expect(cloud.total).toBe(10)
    expect(cloud.stride).toBe(1)

    points.forEach((point, i) => {
      expect(cloud.positions[i * 3]).toBeCloseTo(point.x, 5)
      expect(cloud.positions[i * 3 + 1]).toBeCloseTo(point.y, 5)
      expect(cloud.positions[i * 3 + 2]).toBeCloseTo(point.z, 5)
      expect(cloud.colors[i * 3]).toBeCloseTo(srgbToLinear(point.r / 255), 5)
      expect(cloud.colors[i * 3 + 1]).toBeCloseTo(srgbToLinear(point.g / 255), 5)
      expect(cloud.colors[i * 3 + 2]).toBeCloseTo(srgbToLinear(point.b / 255), 5)
    })

    // `-0` is a real float, so compare numerically rather than structurally.
    cloud.bbox.min.forEach((v, i) => expect(v).toBeCloseTo([0, 0, -9][i] as number, 6))
    cloud.bbox.max.forEach((v, i) => expect(v).toBeCloseTo([9, 4.5, 0][i] as number, 6))
  })

  it('decimates by stride once past the point budget', () => {
    expect(strideForBudget(10, 3)).toBe(4)
    const points = samplePoints(10)
    const file = buildBinaryPly(points)
    const header = parsePlyHeader(file)
    const parser = new PlyPointParser(header, 3)
    feed(parser, file.subarray(header.headerBytes), 64)

    const cloud = parser.finish()
    expect(cloud.stride).toBe(4)
    expect(cloud.count).toBe(3)
    expect(cloud.total).toBe(10)
    // Kept vertices are 0, 4 and 8 — x is the vertex index in the fixture.
    expect([cloud.positions[0], cloud.positions[3], cloud.positions[6]]).toEqual([0, 4, 8])
    expect(cloud.positions).toHaveLength(9)
  })

  it('paints a height ramp when the file carries no colours', () => {
    const file = buildBinaryPly(samplePoints(5), false)
    const header = parsePlyHeader(file)
    expect(header.color).toBeNull()
    const parser = new PlyPointParser(header, 1_000_000)
    feed(parser, file.subarray(header.headerBytes), 13)

    const cloud = parser.finish()
    expect(cloud.count).toBe(5)
    expect(cloud.colors).toHaveLength(15)
    // The ramp rises with y, so the top point is brighter than the bottom one.
    expect(cloud.colors[12]).toBeGreaterThan(cloud.colors[0])
  })
})

#!/usr/bin/env -S node --import tsx
/**
 * Simulates one phone mapping in a Ghostmap party, for local testing and the Playwright E2E
 * suite (PLAN section 4 / `e2e/README.md`). It only ever speaks REST — keyframe registration
 * is enough to trigger the backend's own `keyframes` realtime publish, so no Ably client is
 * needed here.
 *
 * Flow: `POST /v1/auth/token` with a synthetic device (legacy client access key) -> `POST
 * /v1/sessions/join` by invite code, `kind: "device"` -> register one keyframe every `1/rate`
 * seconds, with a pose that orbits a small object and 500 inline points that draw that object
 * as a colour-coded box (each face a different colour, so a real run is visually obvious in
 * the live viewer) -> `POST /v1/sessions/:id/leave` once `--seconds` have elapsed or the
 * process is interrupted.
 *
 * Usage:
 *   npm run simulate -- --api https://ghostmap-backend.vercel.app --client-key <key> --code ABCD2EFG
 *   npx tsx scripts/simulate-device.ts --api ... --client-key ... --code ... [--seconds 20] [--rate 3]
 */

/* ------------------------------------------------------------------------- CLI arguments */

interface Args {
  api: string
  clientKey: string
  code: string
  seconds: number
  rate: number
  name: string
}

function usage(): never {
  console.error(
    [
      'Usage: simulate-device --api <url> --client-key <key> --code <invite-code> [--seconds 20] [--rate 3] [--name "Simulated iPhone"]',
      '',
      '  --api          Backend base URL, e.g. https://ghostmap-backend.vercel.app',
      '  --client-key   Legacy client access key (CLIENT_ACCESS_KEY on the backend)',
      '  --code         8-character party invite code',
      '  --seconds      How long to stream keyframes before leaving (default 20)',
      '  --rate         Keyframes per second (default 3)',
      '  --name         Device name sent to the backend (default "Simulated iPhone")',
    ].join('\n'),
  )
  process.exit(1)
}

function parseArgs(argv: string[]): Args {
  const raw: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token || !token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      raw[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      raw[key] = next
      i += 1
    } else {
      raw[key] = 'true'
    }
  }

  if (raw.help || raw.h) usage()

  const api = raw.api?.replace(/\/+$/, '')
  const clientKey = raw['client-key']
  const code = raw.code?.trim().toUpperCase()
  if (!api || !clientKey || !code) {
    console.error('Missing required argument(s): --api, --client-key, --code are all required.\n')
    usage()
  }

  const seconds = Number(raw.seconds ?? 20)
  const rate = Number(raw.rate ?? 3)
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`--seconds must be a positive number, got ${raw.seconds}`)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`--rate must be a positive number, got ${raw.rate}`)

  return { api, clientKey, code, seconds, rate, name: raw.name ?? 'Simulated iPhone' }
}

/* ---------------------------------------------------------------------------- backend calls */

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

/** Thin wrapper: throws with the backend's `{ error: { code, message } }` when present. */
async function call<T>(url: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
    ...(headers as Record<string, string> | undefined),
  }
  if (token) finalHeaders.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(url, { ...rest, headers: finalHeaders })
  } catch (e) {
    throw new Error(`Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }

  const text = await response.text()
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  if (!response.ok) {
    const err = (body as ApiErrorBody)?.error
    const detail = err?.message || (typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body))
    throw new Error(`HTTP ${response.status} from ${url}${err?.code ? ` (${err.code})` : ''}: ${detail || response.statusText}`)
  }
  return body as T
}

interface TokenResponse {
  token: string
  expires_at?: string
  role?: string
  device_id?: string
}

interface JoinResponse {
  session?: { id?: string; name?: string; status?: string }
  me?: { id?: string; color?: string; display_name?: string }
}

async function mintDeviceToken(api: string, accessKey: string, deviceId: string, deviceName: string): Promise<TokenResponse> {
  return call<TokenResponse>(`${api}/v1/auth/token`, {
    method: 'POST',
    body: JSON.stringify({
      access_key: accessKey,
      device: { id: deviceId, name: deviceName, platform: 'ios' },
    }),
  })
}

async function joinByCode(api: string, token: string, code: string): Promise<JoinResponse> {
  return call<JoinResponse>(`${api}/v1/sessions/join`, {
    method: 'POST',
    token,
    body: JSON.stringify({ code, kind: 'device' }),
  })
}

async function registerKeyframe(api: string, token: string, sessionId: string, keyframe: Record<string, unknown>): Promise<void> {
  await call(`${api}/v1/sessions/${encodeURIComponent(sessionId)}/keyframes`, {
    method: 'POST',
    token,
    body: JSON.stringify({ keyframes: [keyframe] }),
  })
}

async function leaveSession(api: string, token: string, sessionId: string): Promise<void> {
  await call(`${api}/v1/sessions/${encodeURIComponent(sessionId)}/leave`, { method: 'POST', token })
}

/* ------------------------------------------------------------------- synthetic scene + pose */

/** A stationary 0.8 m cube at the origin, each face a different colour (classic RGB-cube test
 * pattern) so a real run is unmistakable in the live viewer. Built once and reused for every
 * keyframe, the way a real phone would keep re-observing the same static room. */
function buildColoredBoxPoints(count: number): number[] {
  const half = 0.4
  // [axis index 0..2, sign, r, g, b]
  const faces: Array<{ axis: 0 | 1 | 2; sign: 1 | -1; color: [number, number, number] }> = [
    { axis: 0, sign: 1, color: [255, 0, 0] }, // +X red
    { axis: 0, sign: -1, color: [0, 255, 255] }, // -X cyan
    { axis: 1, sign: 1, color: [0, 255, 0] }, // +Y green
    { axis: 1, sign: -1, color: [255, 0, 255] }, // -Y magenta
    { axis: 2, sign: 1, color: [0, 0, 255] }, // +Z blue
    { axis: 2, sign: -1, color: [255, 255, 0] }, // -Z yellow
  ]

  const flat: number[] = []
  for (let i = 0; i < count; i += 1) {
    const face = faces[i % faces.length]!
    const u = (Math.random() * 2 - 1) * half
    const v = (Math.random() * 2 - 1) * half
    const point = [0, 0, 0]
    const other = [0, 1, 2].filter((a) => a !== face.axis) as [number, number]
    point[face.axis] = face.sign * half
    point[other[0]] = u
    point[other[1]] = v
    flat.push(point[0]!, point[1]!, point[2]!, face.color[0], face.color[1], face.color[2])
  }
  return flat
}

/** Column-major 4x4 camera-to-world transform (ARKit convention): columns are right, up, back
 * and translation. Orbits the origin at a fixed radius, always looking at the box. */
function orbitPose(t: number): number[] {
  const radius = 2.5
  const height = 1.2
  const angularSpeed = (2 * Math.PI) / 10 // one full lap every 10 seconds, regardless of --seconds
  const angle = t * angularSpeed

  const eye = [radius * Math.cos(angle), height, radius * Math.sin(angle)] as const
  const target = [0, 0, 0] as const
  const worldUp = [0, 1, 0] as const

  const forward = normalize(sub(target, eye))
  const right = normalize(cross(forward, worldUp))
  const up = cross(right, forward)
  const back = [-forward[0], -forward[1], -forward[2]] as const

  return [
    right[0], right[1], right[2], 0,
    up[0], up[1], up[2], 0,
    back[0], back[1], back[2], 0,
    eye[0], eye[1], eye[2], 1,
  ]
}

type Vec3 = readonly [number, number, number]
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

/* ---------------------------------------------------------------------------------- runtime */

function sleepUntil(deadlineMs: number): Promise<void> {
  const delay = Math.max(0, deadlineMs - Date.now())
  return new Promise((resolve) => setTimeout(resolve, delay))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const deviceId = randomUuid()
  const log = (msg: string): void => console.log(`[simulate-device ${new Date().toISOString()}] ${msg}`)

  log(`minting a device token for ${args.api} (device ${deviceId})`)
  const auth = await mintDeviceToken(args.api, args.clientKey, deviceId, args.name)
  log(`got a ${auth.role ?? 'device'} token, expires ${auth.expires_at ?? 'unknown'}`)

  log(`joining party ${args.code} as a device`)
  const joined = await joinByCode(args.api, auth.token, args.code)
  const sessionId = joined.session?.id
  if (!sessionId) throw new Error('Join response did not include session.id')
  log(`joined session ${sessionId} (${joined.session?.name ?? 'unnamed'}) as participant ${joined.me?.id ?? '?'}`)

  const points = buildColoredBoxPoints(500)
  const totalTicks = Math.round(args.seconds * args.rate)
  const intervalMs = 1000 / args.rate
  const startedAt = Date.now()

  let stopRequested = false
  const onSignal = (signal: string): void => {
    log(`received ${signal}, finishing up and leaving early`)
    stopRequested = true
  }
  process.once('SIGINT', () => onSignal('SIGINT'))
  process.once('SIGTERM', () => onSignal('SIGTERM'))

  let sent = 0
  try {
    for (let seq = 0; seq < totalTicks && !stopRequested; seq += 1) {
      await sleepUntil(startedAt + seq * intervalMs)
      if (stopRequested) break
      const t = (Date.now() - startedAt) / 1000
      const keyframe = {
        seq,
        t,
        pose: orbitPose(t),
        intrinsics: { fx: 1000, fy: 1000, cx: 960, cy: 540, w: 1920, h: 1080 },
        tracking_state: 'normal',
        world_mapping_status: 'mapped',
        aligned: true,
        points_inline: points,
        bytes: points.length * 4,
      }
      try {
        await registerKeyframe(args.api, auth.token, sessionId, keyframe)
        sent += 1
        if (sent === 1 || sent % Math.max(1, args.rate) === 0) {
          log(`registered keyframe seq=${seq} (${sent}/${totalTicks} sent)`)
        }
      } catch (e) {
        log(`keyframe seq=${seq} failed: ${e instanceof Error ? e.message : String(e)} (continuing)`)
      }
    }
  } finally {
    log(`leaving session ${sessionId} after ${sent} keyframe(s)`)
    try {
      await leaveSession(args.api, auth.token, sessionId)
      log('left the party')
    } catch (e) {
      log(`leave failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

/** `crypto.randomUUID` needs the `node:crypto` global, present since Node 14.17 behind a flag
 * and unconditionally since Node 19; fall back to a v4-ish generator for older runtimes. */
function randomUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

main().catch((e: unknown) => {
  console.error(`[simulate-device] fatal: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})

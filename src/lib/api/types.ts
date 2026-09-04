/**
 * Wire types for the Ghostmap backend, derived from docs/PLAN-PHASE2.md (sections 1-3)
 * and ghostmap-backend/docs/API.md.
 *
 * Two conventions live in the backend at once: rows selected with Drizzle serialize as
 * `camelCase` (maps, sessions, participants, keyframes) while hand-built payloads use
 * `snake_case` (`participant_count`, `can_join`, `share_url`, ...). Every response schema
 * here is built with {@link flex}, which accepts *either* casing and always yields
 * `camelCase`, so UI code never has to care. Request bodies are the opposite: they keep the
 * wire (`snake_case`) names the backend validates, so their types are written out literally.
 *
 * Phase 2 is being implemented in the backend concurrently with this dashboard, so every
 * field is tolerant: missing or malformed values fall back (`''`, `0`, `null`, `[]`) instead
 * of throwing, and the API client logs rather than fails when a payload does not match.
 */
import { z } from 'zod'

/* ------------------------------------------------------------------ helpers */

const toCamel = (key: string): string => key.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase())

/**
 * An object schema that accepts `snake_case` or `camelCase` keys. Only the top level is
 * normalized, so opaque JSON blobs (`manifest`, `origin`, `intrinsics`, an Ably token
 * request) keep their original keys.
 */
export function flex<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = { ...src }
    for (const [key, v] of Object.entries(src)) {
      const camel = toCamel(key)
      if (camel !== key && (out[camel] === undefined || out[camel] === null)) out[camel] = v
    }
    return out
  }, z.object(shape))
}

/** Same as {@link flex} but keeps unknown keys, for shapes the backend is still growing. */
export function flexOpen<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = { ...src }
    for (const [key, v] of Object.entries(src)) {
      const camel = toCamel(key)
      if (camel !== key && (out[camel] === undefined || out[camel] === null)) out[camel] = v
    }
    return out
  }, z.object(shape).passthrough())
}

/** Number that tolerates strings (Postgres `bigint`) and missing values. */
const num = (fallback = 0) => z.coerce.number().catch(fallback)
/** String that tolerates missing values. */
const str = (fallback = '') => z.string().catch(fallback)
/** `string | null`: missing, null and wrong types all collapse to `null`. */
const nstr = z.union([z.string(), z.null()]).catch(null)
const bool = (fallback = false) => z.boolean().catch(fallback)
const numArray = z.array(z.coerce.number()).catch(() => [])
const nNumArray = z.union([z.array(z.coerce.number()), z.null()]).catch(null)
const json = z.record(z.string(), z.unknown()).nullable().catch(null)

/* ------------------------------------------------------------------- errors */

/** Error codes the backend documents, plus the party codes added in PLAN section 2. */
export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'session_full',
  'session_ended',
  'not_configured',
  'upstream_error',
  'internal',
  'network_error',
  'invalid_response',
] as const

export type KnownApiErrorCode = (typeof API_ERROR_CODES)[number]
/** Any string is accepted; the known codes get autocomplete. */
export type ApiErrorCode = KnownApiErrorCode | (string & {})

/** `{ "error": { "code", "message", "details?" } }` */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: str('internal'),
    message: str(''),
    details: z.unknown().optional(),
  }),
})
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>

/* --------------------------------------------------------------------- auth */

export const ROLES = ['admin', 'worker', 'user', 'device', 'client'] as const
export type Role = (typeof ROLES)[number] | (string & {})

export const authUserSchema = flex({
  id: str(),
  email: str(),
  name: str(),
  pictureUrl: nstr,
  createdAt: nstr,
  lastLoginAt: nstr,
})
export type AuthUser = z.infer<typeof authUserSchema>

/** `POST /v1/auth/google` -> user or device token. */
export const googleAuthResponseSchema = flex({
  token: str(),
  expiresAt: nstr,
  role: str('user'),
  deviceId: nstr,
  user: authUserSchema.optional(),
})
export type GoogleAuthResponse = z.infer<typeof googleAuthResponseSchema>

/** `GET /v1/auth/me` */
export const authMeSchema = flex({
  role: str('client'),
  user: authUserSchema.nullish(),
  deviceId: nstr,
})
export type AuthMe = z.infer<typeof authMeSchema>

/** Body of `POST /v1/auth/google` (wire names). */
export interface GoogleAuthRequest {
  id_token: string
  device?: { id: string; name: string; platform: 'ios' | 'ipados' | 'web' }
}

/**
 * `localStorage["ghostmap.auth"]`. The key and field names are fixed by PLAN section 4,
 * so `expires_at` stays snake_case here.
 */
export const storedAuthSchema = z.object({
  kind: z.enum(['admin', 'user']),
  token: z.string().min(1),
  user: authUserSchema.optional(),
  expires_at: z.string().optional(),
})
export type StoredAuth = z.infer<typeof storedAuthSchema>

/* --------------------------------------------------------------------- health */

/** `GET /health` */
export const healthSchema = flexOpen({
  ok: bool(true),
  version: str(),
  region: str(),
  time: str(),
})
export type Health = z.infer<typeof healthSchema>

/* ----------------------------------------------------------------------- maps */

export const MAP_FILES = [
  'manifest.json',
  'keyframes.bin',
  'cloud.ply',
  'thumbnail.png',
  'worldmap.arworldmap',
  'session.log',
] as const
export type MapFileName = (typeof MAP_FILES)[number]

export const MAP_STATUSES = ['uploading', 'saved', 'failed', 'deleted'] as const
export type MapStatus = (typeof MAP_STATUSES)[number] | (string & {})

export const mapRecordSchema = flex({
  id: str(),
  name: str(),
  version: num(1),
  parentMapId: nstr,
  sessionId: nstr,
  deviceId: nstr,
  /** PLAN section 1: ownership, nullable for legacy rows. */
  ownerUserId: nstr,
  ownerName: nstr,
  frame: str('world:session-start'),
  origin: json,
  status: str('saved'),
  manifest: json,
  pointCount: num(),
  keyframeCount: num(),
  bbox: json,
  durationS: num(),
  sizeBytes: num(),
  files: z.array(z.string()).catch(() => []),
  createdAt: nstr,
  finalizedAt: nstr,
  /** Present only if the backend starts serving a thumbnail URL directly. */
  thumbnailUrl: nstr,
})
export type MapRecord = z.infer<typeof mapRecordSchema>

export const signedUrlSchema = flex({ url: str(), expiresAt: nstr })
export type SignedUrl = z.infer<typeof signedUrlSchema>

/** `GET /v1/maps` */
export const mapListResponseSchema = flex({
  maps: z.array(mapRecordSchema).catch(() => []),
  nextCursor: nstr,
})
export type MapListResponse = z.infer<typeof mapListResponseSchema>

/** `GET /v1/maps/:id` — `downloads` is keyed by file name, keys are left untouched. */
export const mapDetailResponseSchema = flex({
  map: mapRecordSchema,
  downloads: z.record(z.string(), signedUrlSchema).catch(() => ({})),
})
export type MapDetailResponse = z.infer<typeof mapDetailResponseSchema>

export const mapMutationResponseSchema = flex({ map: mapRecordSchema })
export type MapMutationResponse = z.infer<typeof mapMutationResponseSchema>

export const deleteMapResponseSchema = flex({ deleted: bool(true), objectsRemoved: num() })
export type DeleteMapResponse = z.infer<typeof deleteMapResponseSchema>

export interface MapListParams {
  limit?: number
  /** ISO date of the last row of the previous page. */
  cursor?: string
  status?: MapStatus
  session_id?: string
}

/* ------------------------------------------------------------------- parties */

export const SESSION_STATUSES = ['active', 'ended', 'merged', 'failed'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number] | (string & {})

export type ParticipantKind = 'device' | 'viewer'

/** The fixed palette of 8 colors the backend assigns on first join (PLAN section 2). */
export const PARTICIPANT_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#facc15',
  '#c084fc',
  '#fb923c',
  '#2dd4bf',
  '#f87171',
] as const

export const sessionRecordSchema = flex({
  id: str(),
  name: str(),
  status: str('active'),
  origin: json,
  leaderDeviceId: nstr,
  baseMapId: nstr,
  mergedMapId: nstr,
  keyframeCount: num(),
  bytes: num(),
  createdAt: nstr,
  endedAt: nstr,
  /** PLAN section 2. */
  inviteCode: nstr,
  maxParticipants: num(4),
  ownerUserId: nstr,
  ownerName: nstr,
  shareUrl: nstr,
  participantCount: num(),
})
export type SessionRecord = z.infer<typeof sessionRecordSchema>

export const sessionParticipantSchema = flex({
  /** Row id; string or bigserial depending on the migration, always exposed as a string. */
  id: z.union([z.string(), z.number().transform(String)]).catch(''),
  sessionId: str(),
  deviceId: nstr,
  userId: nstr,
  /** `leader` | `member` (legacy role column). */
  role: str('member'),
  /** PLAN section 2: `device` mappers publish, `viewer`s only watch. */
  kind: str('device'),
  color: str(''),
  displayName: str(''),
  joinedAt: nstr,
  leftAt: nstr,
})
export type SessionParticipant = z.infer<typeof sessionParticipantSchema>

export const sessionResponseSchema = flex({
  session: sessionRecordSchema,
  participants: z.array(sessionParticipantSchema).catch(() => []),
  channel: str(),
  shareUrl: nstr,
})
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export const sessionListResponseSchema = flex({
  sessions: z.array(sessionRecordSchema).catch(() => []),
})
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>

/** `GET /v1/sessions/by-code/:code` */
export const sessionByCodeResponseSchema = flex({
  session: sessionRecordSchema,
  canJoin: bool(false),
  reason: nstr,
})
export type SessionByCodeResponse = z.infer<typeof sessionByCodeResponseSchema>

export const realtimeTokenSchema = flex({
  /** Ably `TokenRequest`; hand it straight to the SDK's `authCallback`. */
  tokenRequest: z.unknown(),
  channel: str(),
  canPublish: bool(false),
})
export type RealtimeToken = z.infer<typeof realtimeTokenSchema>

/** `POST /v1/sessions/join` */
export const joinSessionResponseSchema = flex({
  session: sessionRecordSchema,
  participants: z.array(sessionParticipantSchema).catch(() => []),
  channel: str(),
  shareUrl: nstr,
  me: sessionParticipantSchema.nullish(),
  /** `null` when Ably is not configured on the backend. */
  realtime: realtimeTokenSchema.nullish(),
})
export type JoinSessionResponse = z.infer<typeof joinSessionResponseSchema>

export const leaveSessionResponseSchema = flex({
  left: bool(true),
  participants: z.array(sessionParticipantSchema).catch(() => []),
})
export type LeaveSessionResponse = z.infer<typeof leaveSessionResponseSchema>

export const endSessionResponseSchema = flex({ session: sessionRecordSchema })
export type EndSessionResponse = z.infer<typeof endSessionResponseSchema>

/** Body of `POST /v1/sessions` (wire names). */
export interface CreateSessionRequest {
  name: string
  origin?: { type: 'session-start' | 'marker'; marker_id?: string }
  base_map_id?: string
  /** Default 4, maximum 8; counts distinct active accounts, not phones. */
  max_participants?: number
}

/** Body of `POST /v1/sessions/join` (wire names). */
export interface JoinSessionRequest {
  code: string
  /** Defaults to `device` for device tokens and `viewer` for user tokens. */
  kind?: ParticipantKind
  display_name?: string
}

/** Body of `POST /v1/sessions/:id/join` (wire names). */
export interface JoinSessionByIdRequest {
  kind?: ParticipantKind
  display_name?: string
}

export interface SessionListParams {
  status?: SessionStatus
  limit?: number
}

/* ---------------------------------------------------------------- keyframes */

export const intrinsicsSchema = flex({
  fx: num(),
  fy: num(),
  cx: num(),
  cy: num(),
  w: num(),
  h: num(),
})
export type Intrinsics = z.infer<typeof intrinsicsSchema>

export const keyframeSchema = flex({
  id: num(),
  sessionId: nstr,
  deviceId: nstr,
  seq: num(),
  /** Capture timestamp, seconds. */
  t: num(),
  /** 4x4 column-major camera pose in the session origin frame. */
  pose: numArray,
  intrinsics: intrinsicsSchema.nullish(),
  trackingState: str('normal'),
  worldMappingStatus: str('unknown'),
  /** PLAN section 2: false means the pose is not yet in the session origin frame. */
  aligned: bool(true),
  depthRef: nstr,
  confidenceRef: nstr,
  jpegRef: nstr,
  meshRef: nstr,
  /** Flat `[x, y, z, r, g, b, ...]`, at most 2000 points. */
  pointsInline: nNumArray,
  bytes: num(),
  createdAt: nstr,
  /** Present when the request asked for `urls=1`. */
  urls: z.record(z.string(), z.string().nullish()).nullish(),
})
export type Keyframe = z.infer<typeof keyframeSchema>

export const keyframesResponseSchema = flex({
  keyframes: z.array(keyframeSchema).catch(() => []),
  nextSinceId: num(),
})
export type KeyframesResponse = z.infer<typeof keyframesResponseSchema>

export interface KeyframeQueryParams {
  device_id?: string
  since_id?: number
  limit?: number
  /** `1` to include signed download URLs for the blobs. */
  urls?: 0 | 1
}

/* ------------------------------------------------- realtime channel payloads */

/** Server -> clients on `session:<id>`, event `keyframes`. */
export const keyframesMessageSchema = flex({
  deviceId: nstr,
  userId: nstr,
  color: nstr,
  keyframes: z.array(keyframeSchema).catch(() => []),
})
export type KeyframesMessage = z.infer<typeof keyframesMessageSchema>

/** Event `participant`. */
export const participantMessageSchema = flex({
  event: str('joined'),
  participant: sessionParticipantSchema.optional(),
  deviceId: nstr,
})
export type ParticipantMessage = z.infer<typeof participantMessageSchema>

/** Event `session`. */
export const sessionMessageSchema = flex({ event: str('ended') })
export type SessionMessage = z.infer<typeof sessionMessageSchema>

/** Event `merge`. */
export const mergeMessageSchema = flex({
  event: str(''),
  jobId: nstr,
  mapId: nstr,
  error: nstr,
})
export type MergeMessage = z.infer<typeof mergeMessageSchema>

/** Devices -> channel at up to 10 Hz, event `pose`. */
export const poseMessageSchema = flex({
  deviceId: nstr,
  t: num(),
  pose: numArray,
  aligned: bool(true),
})
export type PoseMessage = z.infer<typeof poseMessageSchema>

/** Ably presence data every client enters with. */
export const presenceDataSchema = flex({
  userId: nstr,
  displayName: str(''),
  kind: str('viewer'),
  color: str(''),
})
export type PresenceData = z.infer<typeof presenceDataSchema>

/* -------------------------------------------------------------------- admin */

export const adminOverviewSchema = flexOpen({
  overview: flexOpen({
    devices: num(),
    maps: num(),
    mapBytes: num(),
    activeSessions: num(),
    sessions: num(),
    keyframes: num(),
    pendingMerges: num(),
    users: num(),
  }),
  region: str(),
  version: str(),
})
export type AdminOverview = z.infer<typeof adminOverviewSchema>

export const networkTotalsSchema = flexOpen({
  requests: num(),
  serverErrors: num(),
  clientErrors: num(),
  p50Ms: num(),
  p95Ms: num(),
  p99Ms: num(),
  avgMs: num(),
  bytesIn: num(),
  bytesOut: num(),
})
export type NetworkTotals = z.infer<typeof networkTotalsSchema>

export const adminNetworkSchema = flexOpen({
  windowHours: num(24),
  since: nstr,
  totals: networkTotalsSchema,
  byRoute: z
    .array(
      flexOpen({
        method: str(),
        route: str(),
        requests: num(),
        p95Ms: num(),
        avgMs: num(),
        errors: num(),
        bytesIn: num(),
        bytesOut: num(),
      }),
    )
    .catch(() => []),
  byRegion: z.array(flexOpen({ region: str(), requests: num(), avgMs: num() })).catch(() => []),
  byCountry: z.array(flexOpen({ country: str(), requests: num() })).catch(() => []),
  perHour: z.array(flexOpen({ hour: str(), requests: num(), bytes: num() })).catch(() => []),
})
export type AdminNetwork = z.infer<typeof adminNetworkSchema>

export const adminStorageSchema = flexOpen({
  configured: bool(false),
  bucket: nstr,
  totalBytes: num(),
  totalObjects: num(),
  prefixes: z.record(z.string(), flexOpen({ bytes: num(), objects: num() })).catch(() => ({})),
  cached: bool(false),
  updatedAt: nstr,
})
export type AdminStorage = z.infer<typeof adminStorageSchema>

export const healthCheckSchema = flexOpen({ ok: bool(false), detail: nstr })
export type HealthCheck = z.infer<typeof healthCheckSchema>

export const adminHealthSchema = flexOpen({
  ok: bool(false),
  checks: flexOpen({
    database: healthCheckSchema.optional(),
    gcp: healthCheckSchema.optional(),
    ably: healthCheckSchema.optional(),
    newrelic: healthCheckSchema.optional(),
  }),
  region: str(),
})
export type AdminHealth = z.infer<typeof adminHealthSchema>

/** Existing `GET /admin/costs`: rows straight out of the BigQuery billing export. */
export const billingCostsSchema = flexOpen({
  days: num(30),
  rows: z
    .array(flexOpen({ day: str(), service: str(), costUsd: num(), creditsUsd: num() }))
    .catch(() => []),
  byService: z.record(z.string(), z.coerce.number()).catch(() => ({})),
  totalUsd: num(),
  cached: bool(false),
  updatedAt: nstr,
})
export type BillingCosts = z.infer<typeof billingCostsSchema>

export const migrateResponseSchema = flexOpen({
  ok: bool(true),
  statements: num(),
  applied: z.array(z.string()).catch(() => []),
})
export type MigrateResponse = z.infer<typeof migrateResponseSchema>

export const newRelicPushResponseSchema = flexOpen({
  sent: bool(false),
  metrics: num(),
  reason: nstr,
})
export type NewRelicPushResponse = z.infer<typeof newRelicPushResponseSchema>

/* --------------------------------------------------------- costs (PLAN 3) */

/** One row of `src/lib/costs/pricing.ts`: a provider metric with its verified list price. */
export const pricingEntrySchema = flexOpen({
  provider: str(),
  metric: str(),
  unit: str(),
  unitPriceUsd: num(),
  freeQuota: num(),
  /** YYYY-MM-DD the price was last checked against the provider's page. */
  asOf: nstr,
  source: nstr,
  verified: bool(false),
  /** `PriceEntry.note` on the backend (singular) — a caveat, e.g. why a price is unverified. */
  note: nstr,
})
export type PricingEntry = z.infer<typeof pricingEntrySchema>

/** `GET /admin/costs/pricing` */
export const pricingResponseSchema = flexOpen({
  pricing: z.array(pricingEntrySchema).catch(() => []),
  generatedAt: nstr,
})
export type PricingResponse = z.infer<typeof pricingResponseSchema>

export const costItemSchema = flexOpen({
  metric: str(),
  quantity: num(),
  unit: str(),
  freeQuota: num(),
  billableQuantity: num(),
  unitPriceUsd: num(),
  costUsd: num(),
  source: nstr,
  asOf: nstr,
  verified: bool(false),
})
export type CostItem = z.infer<typeof costItemSchema>

export const freeTierStatusSchema = flexOpen({
  usedPctMax: num(),
  firstExhaustedMetric: nstr,
  daysUntilPaidAtCurrentRate: z.union([z.coerce.number(), z.null()]).catch(null),
})
export type FreeTierStatus = z.infer<typeof freeTierStatusSchema>

export const providerCostSchema = flexOpen({
  provider: str(),
  items: z.array(costItemSchema).catch(() => []),
  totalUsd: num(),
  freeTier: freeTierStatusSchema.optional(),
})
export type ProviderCost = z.infer<typeof providerCostSchema>

/** `estimate()` / `project()` output — `GET /admin/costs/overview` and `/projection`. */
export const costReportSchema = flexOpen({
  providers: z.array(providerCostSchema).catch(() => []),
  actual: z.record(z.string(), z.unknown()).nullable().catch(null),
  grandTotalUsd: num(),
  monthlyRunRateUsd: num(),
  assumptions: z.array(z.string()).catch(() => []),
  days: num(30),
  generatedAt: nstr,
})
export type CostReport = z.infer<typeof costReportSchema>

/**
 * `MeasuredUsage` from `ghostmap-backend/src/lib/costs/usage.ts`: everything `measureUsage()`
 * read from `api_usage`, `usage_events`, GCS and the inventory tables for the window.
 */
export const measuredUsageSchema = flexOpen({
  windowDays: num(),
  since: nstr,
  api: flexOpen({
    requests: num(),
    bytesIn: num(),
    bytesOut: num(),
    durationMs: num(),
    googleSignIns: num(),
  }),
  /** Keyed by `UsageEventKind` (`ably_publish`, `signed_upload`, ...), not an array on the wire. */
  events: z.record(z.string(), flexOpen({ count: num(), bytes: num() })).catch(() => ({})),
  storage: flexOpen({
    totalBytes: num(),
    totalObjects: num(),
    avgObjectBytes: num(),
    configured: bool(false),
    cached: bool(false),
    updatedAt: nstr,
  }),
  database: flexOpen({ sizeBytes: num() }),
  inventory: flexOpen({
    keyframes: num(),
    keyframeBytes: num(),
    maps: num(),
    mapBytes: num(),
    sessions: num(),
    activeSessions: num(),
    activeParticipants: num(),
    participantJoins: num(),
    participantLeaves: num(),
  }),
  merges: flexOpen({ finished: num(), seconds: num() }),
})
export type MeasuredUsage = z.infer<typeof measuredUsageSchema>

/** Flattens `measured` into `metric.path -> number`, for a simple sortable key/value display. */
function flattenMeasuredUsage(m: MeasuredUsage): Record<string, number> {
  return {
    'api.requests': m.api.requests,
    'api.bytesIn': m.api.bytesIn,
    'api.bytesOut': m.api.bytesOut,
    'api.durationMs': m.api.durationMs,
    'api.googleSignIns': m.api.googleSignIns,
    'storage.totalBytes': m.storage.totalBytes,
    'storage.totalObjects': m.storage.totalObjects,
    'storage.avgObjectBytes': m.storage.avgObjectBytes,
    'database.sizeBytes': m.database.sizeBytes,
    'inventory.keyframes': m.inventory.keyframes,
    'inventory.keyframeBytes': m.inventory.keyframeBytes,
    'inventory.maps': m.inventory.maps,
    'inventory.mapBytes': m.inventory.mapBytes,
    'inventory.sessions': m.inventory.sessions,
    'inventory.activeSessions': m.inventory.activeSessions,
    'inventory.activeParticipants': m.inventory.activeParticipants,
    'inventory.participantJoins': m.inventory.participantJoins,
    'inventory.participantLeaves': m.inventory.participantLeaves,
    'merges.finished': m.merges.finished,
    'merges.seconds': m.merges.seconds,
  }
}

/**
 * `GET /admin/costs/usage` — measured quantities behind the estimate. The backend nests
 * everything under `measured` (see `UsageResult` in `usage.ts`); `metrics` and `events` are
 * derived here into the flat shapes the Metrics tab renders.
 */
export const usageReportSchema = flexOpen({
  days: num(30),
  since: nstr,
  measured: measuredUsageSchema,
  caveats: z.array(z.string()).catch(() => []),
}).transform((r) => ({
  ...r,
  metrics: flattenMeasuredUsage(r.measured),
  events: Object.entries(r.measured.events).map(([kind, totals]) => ({
    kind,
    count: totals.count,
    bytes: totals.bytes,
  })),
}))
export type UsageReport = z.infer<typeof usageReportSchema>

/** Query for `GET /admin/costs/projection` (wire names, all optional). */
export interface ProjectionParams {
  mappers?: number
  sessions_per_day?: number
  minutes_per_session?: number
  keyframes_per_second?: number
  depth_bytes_per_keyframe?: number
  /** 0 = never upload JPEGs. */
  jpeg_every_n?: number
  viewers_per_session?: number
  map_size_mb?: number
  maps_per_day?: number
  retention_days?: number
  dashboard_views_per_day?: number
}

/** Defaults from PLAN section 3; the projection calculator starts here. */
export const DEFAULT_PROJECTION_PARAMS: Required<ProjectionParams> = {
  mappers: 2,
  sessions_per_day: 2,
  minutes_per_session: 10,
  keyframes_per_second: 3,
  depth_bytes_per_keyframe: 55_000,
  jpeg_every_n: 0,
  viewers_per_session: 1,
  map_size_mb: 25,
  maps_per_day: 2,
  retention_days: 30,
  dashboard_views_per_day: 20,
}

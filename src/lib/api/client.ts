/**
 * Typed fetch client for the Ghostmap backend.
 *
 * - Base URL: the /settings override, else `VITE_API_BASE` (see `src/lib/config.ts`).
 * - Auth: bearer token from `localStorage["ghostmap.auth"]`, overridable per call
 *   (`token: '...'` to use another key, `token: null` to send no credentials).
 * - Errors: every failure — HTTP, transport or malformed body — surfaces as an
 *   {@link ApiError} carrying the backend's `{ error: { code, message } }` when present.
 * - Tolerance: responses are validated with the zod schemas in `types.ts`, but a schema
 *   mismatch only warns; the raw payload is returned so a backend still under construction
 *   never blanks out the UI.
 */
import type { z } from 'zod'
import { currentToken, getApiBase } from '../config'
import {
  adminHealthSchema,
  adminNetworkSchema,
  adminOverviewSchema,
  adminStorageSchema,
  apiErrorBodySchema,
  authMeSchema,
  billingCostsSchema,
  costReportSchema,
  deleteMapResponseSchema,
  endSessionResponseSchema,
  googleAuthResponseSchema,
  healthSchema,
  joinSessionResponseSchema,
  keyframesResponseSchema,
  leaveSessionResponseSchema,
  mapDetailResponseSchema,
  mapListResponseSchema,
  mapMutationResponseSchema,
  migrateResponseSchema,
  newRelicPushResponseSchema,
  pricingResponseSchema,
  realtimeTokenSchema,
  sessionByCodeResponseSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  usageReportSchema,
  type AdminHealth,
  type AdminNetwork,
  type AdminOverview,
  type AdminStorage,
  type ApiErrorCode,
  type AuthMe,
  type BillingCosts,
  type CostReport,
  type CreateSessionRequest,
  type DeleteMapResponse,
  type EndSessionResponse,
  type GoogleAuthRequest,
  type GoogleAuthResponse,
  type Health,
  type JoinSessionByIdRequest,
  type JoinSessionRequest,
  type JoinSessionResponse,
  type KeyframeQueryParams,
  type KeyframesResponse,
  type LeaveSessionResponse,
  type MapDetailResponse,
  type MapListParams,
  type MapListResponse,
  type MapMutationResponse,
  type MigrateResponse,
  type NewRelicPushResponse,
  type PricingResponse,
  type ProjectionParams,
  type RealtimeToken,
  type SessionByCodeResponse,
  type SessionListParams,
  type SessionListResponse,
  type SessionResponse,
  type UsageReport,
} from './types'

/* -------------------------------------------------------------------- errors */

/** Status -> code fallback for responses that are not the documented error envelope. */
const STATUS_CODES: Readonly<Record<number, ApiErrorCode>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'session_ended',
  501: 'not_configured',
  502: 'upstream_error',
}

export function codeForStatus(status: number): ApiErrorCode {
  return STATUS_CODES[status] ?? (status >= 500 ? 'internal' : status >= 400 ? 'bad_request' : 'internal')
}

/** Every failure from {@link request} is one of these. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number
  readonly details?: unknown

  constructor(code: ApiErrorCode, message: string, status = 0, details?: unknown) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }

  /** Missing or invalid credentials — the caller should send the user to /login. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 'unauthorized'
  }

  /** Authenticated but not allowed; used to hide admin UI rather than to sign out. */
  get isForbidden(): boolean {
    return this.status === 403 || this.code === 'forbidden'
  }

  /** The server could not be reached at all. */
  get isNetworkError(): boolean {
    return this.code === 'network_error'
  }

  /** Backend feature not configured (BigQuery export, New Relic, ...). */
  get isNotConfigured(): boolean {
    return this.status === 501 || this.code === 'not_configured'
  }

  /**
   * Builds an error from a non-2xx response body: the documented
   * `{ error: { code, message, details? } }` envelope when present, otherwise a code
   * derived from the status and whatever text the server sent.
   */
  static fromBody(status: number, body: unknown, fallbackText?: string): ApiError {
    const parsed = apiErrorBodySchema.safeParse(body)
    if (parsed.success) {
      const { code, message, details } = parsed.data.error
      return new ApiError(code || codeForStatus(status), message || `HTTP ${status}`, status, details)
    }
    const text = typeof body === 'string' && body ? body : (fallbackText ?? '')
    return new ApiError(codeForStatus(status), text.slice(0, 500) || `HTTP ${status}`, status, body ?? undefined)
  }
}

/** Type guard so callers can branch on `error.code` inside TanStack Query callbacks. */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

/* ------------------------------------------------------------------- request */

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export function toQueryString(params?: QueryParams): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Serialized as JSON unless it is already a string/FormData. */
  body?: unknown
  query?: QueryParams
  /** `undefined` uses the stored token; a string overrides it; `null` sends none. */
  token?: string | null
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Overrides the configured base URL (used by /settings to test a URL). */
  baseUrl?: string
  /**
   * Validates and normalizes the payload; a mismatch warns instead of throwing.
   * `Input` is left open because the `flex()` schemas preprocess an unknown value.
   */
  schema?: z.ZodType<T, z.ZodTypeDef, any>
}

/** Low-level request. Prefer the {@link api} namespace, which supplies the schemas. */
export async function request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, query, token, headers = {}, signal, baseUrl, schema } = options
  const base = (baseUrl ?? getApiBase()).replace(/\/+$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}${toQueryString(query)}`

  const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers }
  const bearer = token === undefined ? currentToken() : token
  if (bearer) finalHeaders.Authorization = `Bearer ${bearer}`

  let payload: BodyInit | undefined
  if (body !== undefined && body !== null) {
    if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
      payload = body
    } else {
      payload = JSON.stringify(body)
      finalHeaders['Content-Type'] = 'application/json'
    }
  }

  let response: Response
  try {
    response = await fetch(url, { method, headers: finalHeaders, body: payload, signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError('network_error', `Could not reach ${base}: ${errorMessage(e)}`, 0)
  }

  const raw = await response.text()
  let parsedBody: unknown = undefined
  if (raw) {
    try {
      parsedBody = JSON.parse(raw) as unknown
    } catch {
      parsedBody = raw
    }
  }

  if (!response.ok) throw ApiError.fromBody(response.status, parsedBody, response.statusText)

  if (parsedBody === undefined) return undefined as T
  if (typeof parsedBody === 'string') {
    throw new ApiError('invalid_response', `Expected JSON from ${path}, got text`, response.status, parsedBody.slice(0, 200))
  }

  if (!schema) return parsedBody as T
  const result = schema.safeParse(parsedBody)
  if (result.success) return result.data
  console.warn(`[api] ${path} did not match its schema; using the raw payload.`, result.error.issues)
  return parsedBody as T
}

/* ----------------------------------------------------------------- endpoints */

/** Every backend call the dashboard makes, grouped by area. */
export const api = {
  /** `GET /health` — public. */
  health: (signal?: AbortSignal): Promise<Health> =>
    request('/health', { schema: healthSchema, token: null, signal }),

  auth: {
    /** `POST /v1/auth/google` — exchanges a Google id_token for a Ghostmap token. */
    google: (body: GoogleAuthRequest, signal?: AbortSignal): Promise<GoogleAuthResponse> =>
      request('/v1/auth/google', { method: 'POST', body, token: null, schema: googleAuthResponseSchema, signal }),
    /** `GET /v1/auth/me` */
    me: (token?: string | null, signal?: AbortSignal): Promise<AuthMe> =>
      request('/v1/auth/me', { schema: authMeSchema, ...(token === undefined ? {} : { token }), signal }),
  },

  maps: {
    list: (params?: MapListParams, signal?: AbortSignal): Promise<MapListResponse> =>
      request('/v1/maps', { query: params as QueryParams | undefined, schema: mapListResponseSchema, signal }),
    get: (id: string, signal?: AbortSignal): Promise<MapDetailResponse> =>
      request(`/v1/maps/${encodeURIComponent(id)}`, { schema: mapDetailResponseSchema, signal }),
    rename: (id: string, name: string): Promise<MapMutationResponse> =>
      request(`/v1/maps/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name }, schema: mapMutationResponseSchema }),
    remove: (id: string): Promise<DeleteMapResponse> =>
      request(`/v1/maps/${encodeURIComponent(id)}`, { method: 'DELETE', schema: deleteMapResponseSchema }),
    /** Direct link to a stored file; the backend 302s to a 5-minute signed URL. */
    fileUrl: (id: string, name: string): string =>
      `${getApiBase()}/v1/maps/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`,
  },

  sessions: {
    list: (params?: SessionListParams, signal?: AbortSignal): Promise<SessionListResponse> =>
      request('/v1/sessions', { query: params as QueryParams | undefined, schema: sessionListResponseSchema, signal }),
    get: (id: string, signal?: AbortSignal): Promise<SessionResponse> =>
      request(`/v1/sessions/${encodeURIComponent(id)}`, { schema: sessionResponseSchema, signal }),
    /** `GET /v1/sessions/by-code/:code` — the /join/:code preview. */
    byCode: (code: string, signal?: AbortSignal): Promise<SessionByCodeResponse> =>
      request(`/v1/sessions/by-code/${encodeURIComponent(code.toUpperCase())}`, {
        schema: sessionByCodeResponseSchema,
        signal,
      }),
    create: (body: CreateSessionRequest): Promise<SessionResponse> =>
      request('/v1/sessions', { method: 'POST', body, schema: sessionResponseSchema }),
    /** `POST /v1/sessions/join` with an invite code. */
    join: (body: JoinSessionRequest): Promise<JoinSessionResponse> =>
      request('/v1/sessions/join', { method: 'POST', body, schema: joinSessionResponseSchema }),
    /** Join by session id; same response as `join`, for links that carry an id, not a code. */
    joinById: (id: string, body: JoinSessionByIdRequest = {}): Promise<JoinSessionResponse> =>
      request(`/v1/sessions/${encodeURIComponent(id)}/join`, { method: 'POST', body, schema: joinSessionResponseSchema }),
    leave: (id: string): Promise<LeaveSessionResponse> =>
      request(`/v1/sessions/${encodeURIComponent(id)}/leave`, { method: 'POST', schema: leaveSessionResponseSchema }),
    end: (id: string): Promise<EndSessionResponse> =>
      request(`/v1/sessions/${encodeURIComponent(id)}/end`, { method: 'POST', schema: endSessionResponseSchema }),
    /** Catch-up before subscribing to Ably. */
    keyframes: (id: string, params?: KeyframeQueryParams, signal?: AbortSignal): Promise<KeyframesResponse> =>
      request(`/v1/sessions/${encodeURIComponent(id)}/keyframes`, {
        query: params as QueryParams | undefined,
        schema: keyframesResponseSchema,
        signal,
      }),
  },

  realtime: {
    /** `POST /v1/realtime/token` — pass `tokenRequest` to the Ably SDK's `authCallback`. */
    token: (sessionId?: string, signal?: AbortSignal): Promise<RealtimeToken> =>
      request('/v1/realtime/token', {
        method: 'POST',
        body: sessionId ? { session_id: sessionId } : {},
        schema: realtimeTokenSchema,
        signal,
      }),
  },

  admin: {
    overview: (token?: string | null, signal?: AbortSignal): Promise<AdminOverview> =>
      request('/admin/overview', { schema: adminOverviewSchema, ...(token === undefined ? {} : { token }), signal }),
    network: (hours = 24, signal?: AbortSignal): Promise<AdminNetwork> =>
      request('/admin/network', { query: { hours }, schema: adminNetworkSchema, signal }),
    storage: (signal?: AbortSignal): Promise<AdminStorage> =>
      request('/admin/storage', { schema: adminStorageSchema, signal }),
    health: (signal?: AbortSignal): Promise<AdminHealth> =>
      request('/admin/health', { schema: adminHealthSchema, signal }),
    /** Existing BigQuery billing export rows. */
    billingCosts: (days = 30, signal?: AbortSignal): Promise<BillingCosts> =>
      request('/admin/costs', { query: { days }, schema: billingCostsSchema, signal }),
    migrate: (): Promise<MigrateResponse> =>
      request('/admin/db/migrate', { method: 'POST', schema: migrateResponseSchema }),
    newRelicPush: (): Promise<NewRelicPushResponse> =>
      request('/admin/newrelic/push', { method: 'POST', schema: newRelicPushResponseSchema }),

    /** The PLAN section 3 cost module. */
    costs: {
      overview: (days = 30, signal?: AbortSignal): Promise<CostReport> =>
        request('/admin/costs/overview', { query: { days }, schema: costReportSchema, signal }),
      projection: (params?: ProjectionParams, signal?: AbortSignal): Promise<CostReport> =>
        request('/admin/costs/projection', { query: params as QueryParams | undefined, schema: costReportSchema, signal }),
      pricing: (signal?: AbortSignal): Promise<PricingResponse> =>
        request('/admin/costs/pricing', { schema: pricingResponseSchema, signal }),
      usage: (days = 30, signal?: AbortSignal): Promise<UsageReport> =>
        request('/admin/costs/usage', { query: { days }, schema: usageReportSchema, signal }),
    },
  },
} as const

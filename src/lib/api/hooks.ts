/**
 * TanStack Query v5 bindings for every backend endpoint the dashboard uses.
 *
 * Query keys are built by {@link queryKeys} and are scoped by the active API base, so
 * pointing /settings at another deployment can never serve cached rows from the old one.
 * Queries do not retry on 401/403/404/501 — those are answers, not flakes.
 */
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { getApiBase } from '../config'
import { ApiError, api, isApiError } from './client'
import type {
  AdminHealth,
  AdminNetwork,
  AdminOverview,
  AdminStorage,
  BillingCosts,
  CostReport,
  CreateSessionRequest,
  DeleteMapResponse,
  EndSessionResponse,
  Health,
  JoinSessionByIdRequest,
  JoinSessionRequest,
  JoinSessionResponse,
  KeyframeQueryParams,
  KeyframesResponse,
  LeaveSessionResponse,
  MapDetailResponse,
  MapListParams,
  MapListResponse,
  MapMutationResponse,
  MigrateResponse,
  NewRelicPushResponse,
  PricingResponse,
  ProjectionParams,
  RealtimeToken,
  SessionByCodeResponse,
  SessionListParams,
  SessionListResponse,
  SessionResponse,
  UsageReport,
} from './types'

/* ---------------------------------------------------------------- query keys */

/** Root key: everything is namespaced by the API base currently in use. */
const root = () => ['ghostmap', getApiBase()] as const

export const queryKeys = {
  root,
  health: () => [...root(), 'health'] as const,
  authMe: () => [...root(), 'auth', 'me'] as const,
  maps: {
    all: () => [...root(), 'maps'] as const,
    list: (params?: MapListParams) => [...root(), 'maps', 'list', params ?? {}] as const,
    /** Cursor-paginated library; kept apart from `list` because the cached shape differs. */
    infinite: (params?: MapListPageParams) => [...root(), 'maps', 'infinite', params ?? {}] as const,
    detail: (id: string) => [...root(), 'maps', 'detail', id] as const,
  },
  sessions: {
    all: () => [...root(), 'sessions'] as const,
    list: (params?: SessionListParams) => [...root(), 'sessions', 'list', params ?? {}] as const,
    detail: (id: string) => [...root(), 'sessions', 'detail', id] as const,
    byCode: (code: string) => [...root(), 'sessions', 'by-code', code.toUpperCase()] as const,
    keyframes: (id: string, params?: KeyframeQueryParams) =>
      [...root(), 'sessions', 'keyframes', id, params ?? {}] as const,
  },
  realtimeToken: (sessionId?: string) => [...root(), 'realtime', 'token', sessionId ?? null] as const,
  admin: {
    all: () => [...root(), 'admin'] as const,
    overview: () => [...root(), 'admin', 'overview'] as const,
    network: (hours: number) => [...root(), 'admin', 'network', hours] as const,
    storage: () => [...root(), 'admin', 'storage'] as const,
    health: () => [...root(), 'admin', 'health'] as const,
    billingCosts: (days: number) => [...root(), 'admin', 'billing-costs', days] as const,
    costs: {
      overview: (days: number) => [...root(), 'admin', 'costs', 'overview', days] as const,
      projection: (params: ProjectionParams) => [...root(), 'admin', 'costs', 'projection', params] as const,
      pricing: () => [...root(), 'admin', 'costs', 'pricing'] as const,
      usage: (days: number) => [...root(), 'admin', 'costs', 'usage', days] as const,
    },
  },
} as const

/* ------------------------------------------------------------------ defaults */

/** Answers, not flakes: never retry these. */
const NO_RETRY_STATUS = new Set([400, 401, 403, 404, 409, 410, 501])

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && NO_RETRY_STATUS.has(error.status)) return false
  return failureCount < 2
}

/** The app's `QueryClient`; also used by tests and Playwright fixtures. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

/** The subset of query options the hooks below accept. */
export interface QueryOptions {
  enabled?: boolean
  refetchInterval?: number | false
  staleTime?: number
  gcTime?: number
  refetchOnWindowFocus?: boolean
}

type Query<T> = UseQueryResult<T, ApiError>

/* -------------------------------------------------------------------- health */

export function useHealth(options: QueryOptions = {}): Query<Health> {
  return useQuery<Health, ApiError>({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 15_000,
    ...options,
  })
}

/* ---------------------------------------------------------------------- maps */

export function useMaps(params?: MapListParams, options: QueryOptions = {}): Query<MapListResponse> {
  return useQuery<MapListResponse, ApiError>({
    queryKey: queryKeys.maps.list(params),
    queryFn: ({ signal }) => api.maps.list(params, signal),
    ...options,
  })
}

/** `MapListParams` without the cursor, which the infinite query owns. */
export type MapListPageParams = Omit<MapListParams, 'cursor'>

/**
 * The map library's paginated feed. The backend returns `next_cursor` (the ISO date of the
 * last row), so pages chain through `getNextPageParam`; `undefined` ends the list.
 */
export function useMapsInfinite(
  params?: MapListPageParams,
  options: QueryOptions = {},
): UseInfiniteQueryResult<InfiniteData<MapListResponse, string | undefined>, ApiError> {
  return useInfiniteQuery<
    MapListResponse,
    ApiError,
    InfiniteData<MapListResponse, string | undefined>,
    ReturnType<typeof queryKeys.maps.infinite>,
    string | undefined
  >({
    queryKey: queryKeys.maps.infinite(params),
    queryFn: ({ pageParam, signal }) =>
      api.maps.list({ ...(params ?? {}), ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    ...options,
  })
}

export function useMap(id: string | undefined, options: QueryOptions = {}): Query<MapDetailResponse> {
  return useQuery<MapDetailResponse, ApiError>({
    queryKey: queryKeys.maps.detail(id ?? ''),
    queryFn: ({ signal }) => api.maps.get(id as string, signal),
    enabled: Boolean(id) && (options.enabled ?? true),
    ...options,
  })
}

export function useRenameMap(): UseMutationResult<MapMutationResponse, ApiError, { id: string; name: string }> {
  const qc = useQueryClient()
  return useMutation<MapMutationResponse, ApiError, { id: string; name: string }>({
    mutationFn: ({ id, name }) => api.maps.rename(id, name),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.maps.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.maps.all() })
    },
  })
}

export function useDeleteMap(): UseMutationResult<DeleteMapResponse, ApiError, string> {
  const qc = useQueryClient()
  return useMutation<DeleteMapResponse, ApiError, string>({
    mutationFn: (id) => api.maps.remove(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: queryKeys.maps.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.maps.all() })
    },
  })
}

/* ------------------------------------------------------------------- parties */

export function useSessions(params?: SessionListParams, options: QueryOptions = {}): Query<SessionListResponse> {
  return useQuery<SessionListResponse, ApiError>({
    queryKey: queryKeys.sessions.list(params),
    queryFn: ({ signal }) => api.sessions.list(params, signal),
    ...options,
  })
}

export function useSession(id: string | undefined, options: QueryOptions = {}): Query<SessionResponse> {
  return useQuery<SessionResponse, ApiError>({
    queryKey: queryKeys.sessions.detail(id ?? ''),
    queryFn: ({ signal }) => api.sessions.get(id as string, signal),
    enabled: Boolean(id) && (options.enabled ?? true),
    ...options,
  })
}

/** Preview for /join/:code. Invite codes are 8 uppercase base32 characters. */
export function useSessionByCode(code: string | undefined, options: QueryOptions = {}): Query<SessionByCodeResponse> {
  return useQuery<SessionByCodeResponse, ApiError>({
    queryKey: queryKeys.sessions.byCode(code ?? ''),
    queryFn: ({ signal }) => api.sessions.byCode(code as string, signal),
    enabled: Boolean(code) && (options.enabled ?? true),
    ...options,
  })
}

export function useSessionKeyframes(
  id: string | undefined,
  params?: KeyframeQueryParams,
  options: QueryOptions = {},
): Query<KeyframesResponse> {
  return useQuery<KeyframesResponse, ApiError>({
    queryKey: queryKeys.sessions.keyframes(id ?? '', params),
    queryFn: ({ signal }) => api.sessions.keyframes(id as string, params, signal),
    enabled: Boolean(id) && (options.enabled ?? true),
    ...options,
  })
}

export function useCreateSession(): UseMutationResult<SessionResponse, ApiError, CreateSessionRequest> {
  const qc = useQueryClient()
  return useMutation<SessionResponse, ApiError, CreateSessionRequest>({
    mutationFn: (body) => api.sessions.create(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.sessions.all() }),
  })
}

export function useJoinSession(): UseMutationResult<JoinSessionResponse, ApiError, JoinSessionRequest> {
  const qc = useQueryClient()
  return useMutation<JoinSessionResponse, ApiError, JoinSessionRequest>({
    mutationFn: (body) => api.sessions.join(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.sessions.all() }),
  })
}

/** Join by session id rather than by invite code. */
export function useJoinSessionById(): UseMutationResult<
  JoinSessionResponse,
  ApiError,
  { id: string } & JoinSessionByIdRequest
> {
  const qc = useQueryClient()
  return useMutation<JoinSessionResponse, ApiError, { id: string } & JoinSessionByIdRequest>({
    mutationFn: ({ id, ...body }) => api.sessions.joinById(id, body),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all() })
    },
  })
}

export function useLeaveSession(): UseMutationResult<LeaveSessionResponse, ApiError, string> {
  const qc = useQueryClient()
  return useMutation<LeaveSessionResponse, ApiError, string>({
    mutationFn: (id) => api.sessions.leave(id),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all() })
    },
  })
}

export function useEndSession(): UseMutationResult<EndSessionResponse, ApiError, string> {
  const qc = useQueryClient()
  return useMutation<EndSessionResponse, ApiError, string>({
    mutationFn: (id) => api.sessions.end(id),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all() })
    },
  })
}

/**
 * Ably credentials for a session channel. Kept short-lived; the live view should pass
 * `api.realtime.token` to the SDK's `authCallback` for automatic renewal rather than
 * relying on this cache.
 */
export function useRealtimeToken(sessionId: string | undefined, options: QueryOptions = {}): Query<RealtimeToken> {
  return useQuery<RealtimeToken, ApiError>({
    queryKey: queryKeys.realtimeToken(sessionId),
    queryFn: ({ signal }) => api.realtime.token(sessionId, signal),
    enabled: Boolean(sessionId) && (options.enabled ?? true),
    staleTime: 0,
    gcTime: 0,
    ...options,
  })
}

/* -------------------------------------------------------------------- admin */

export function useAdminOverview(options: QueryOptions = {}): Query<AdminOverview> {
  return useQuery<AdminOverview, ApiError>({
    queryKey: queryKeys.admin.overview(),
    queryFn: ({ signal }) => api.admin.overview(undefined, signal),
    ...options,
  })
}

export function useAdminNetwork(hours = 24, options: QueryOptions = {}): Query<AdminNetwork> {
  return useQuery<AdminNetwork, ApiError>({
    queryKey: queryKeys.admin.network(hours),
    queryFn: ({ signal }) => api.admin.network(hours, signal),
    ...options,
  })
}

export function useAdminStorage(options: QueryOptions = {}): Query<AdminStorage> {
  return useQuery<AdminStorage, ApiError>({
    queryKey: queryKeys.admin.storage(),
    queryFn: ({ signal }) => api.admin.storage(signal),
    staleTime: 5 * 60_000,
    ...options,
  })
}

export function useAdminHealth(options: QueryOptions = {}): Query<AdminHealth> {
  return useQuery<AdminHealth, ApiError>({
    queryKey: queryKeys.admin.health(),
    queryFn: ({ signal }) => api.admin.health(signal),
    ...options,
  })
}

/** Existing `/admin/costs` (BigQuery billing export rows). */
export function useAdminBillingCosts(days = 30, options: QueryOptions = {}): Query<BillingCosts> {
  return useQuery<BillingCosts, ApiError>({
    queryKey: queryKeys.admin.billingCosts(days),
    queryFn: ({ signal }) => api.admin.billingCosts(days, signal),
    staleTime: 60 * 60_000,
    ...options,
  })
}

/* ---------------------------------------------------- costs (PLAN section 3) */

export function useCostOverview(days = 30, options: QueryOptions = {}): Query<CostReport> {
  return useQuery<CostReport, ApiError>({
    queryKey: queryKeys.admin.costs.overview(days),
    queryFn: ({ signal }) => api.admin.costs.overview(days, signal),
    staleTime: 5 * 60_000,
    ...options,
  })
}

/** The projection calculator; sliders change `params` and the key refetches. */
export function useCostProjection(params: ProjectionParams, options: QueryOptions = {}): Query<CostReport> {
  return useQuery<CostReport, ApiError>({
    queryKey: queryKeys.admin.costs.projection(params),
    queryFn: ({ signal }) => api.admin.costs.projection(params, signal),
    staleTime: 5 * 60_000,
    ...options,
  })
}

export function useCostPricing(options: QueryOptions = {}): Query<PricingResponse> {
  return useQuery<PricingResponse, ApiError>({
    queryKey: queryKeys.admin.costs.pricing(),
    queryFn: ({ signal }) => api.admin.costs.pricing(signal),
    staleTime: 24 * 60 * 60_000,
    ...options,
  })
}

export function useCostUsage(days = 30, options: QueryOptions = {}): Query<UsageReport> {
  return useQuery<UsageReport, ApiError>({
    queryKey: queryKeys.admin.costs.usage(days),
    queryFn: ({ signal }) => api.admin.costs.usage(days, signal),
    staleTime: 5 * 60_000,
    ...options,
  })
}

/* ------------------------------------------------------------ admin actions */

/** `POST /admin/db/migrate` — idempotent schema sync. */
export function useDbMigrate(): UseMutationResult<MigrateResponse, ApiError, void> {
  const qc = useQueryClient()
  return useMutation<MigrateResponse, ApiError, void>({
    mutationFn: () => api.admin.migrate(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.admin.all() }),
  })
}

/** `POST /admin/newrelic/push` — sends the metric snapshot on demand. */
export function useNewRelicPush(): UseMutationResult<NewRelicPushResponse, ApiError, void> {
  return useMutation<NewRelicPushResponse, ApiError, void>({
    mutationFn: () => api.admin.newRelicPush(),
  })
}

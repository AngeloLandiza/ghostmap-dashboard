/**
 * Runtime configuration and the two pieces of state we persist in `localStorage`:
 * the signed-in principal (`ghostmap.auth`, shape fixed by PLAN section 4) and an optional
 * API base URL override the user can set on /settings.
 *
 * Everything here is safe to call during SSR/prerender or in a browser with storage
 * disabled: reads fall back to defaults and writes are ignored.
 */
import { storedAuthSchema, type StoredAuth } from './api/types'

export const AUTH_STORAGE_KEY = 'ghostmap.auth'
export const API_BASE_STORAGE_KEY = 'ghostmap.apiBase'

/** `VITE_API_BASE`, or the production deployment. */
export const DEFAULT_API_BASE = (
  import.meta.env.VITE_API_BASE ?? 'https://ghostmap-backend.vercel.app'
).replace(/\/+$/, '')

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null // Safari private mode, blocked cookies, ...
  }
}

/** Cross-tab + same-tab change notification for the keys above. */
const listeners = new Set<(key: string) => void>()

export function subscribeConfig(listener: (key: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(key: string): void {
  for (const l of [...listeners]) l(key)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === AUTH_STORAGE_KEY || e.key === API_BASE_STORAGE_KEY) notify(e.key)
  })
}

/* ------------------------------------------------------------------ api base */

export function getApiBase(): string {
  const raw = storage()?.getItem(API_BASE_STORAGE_KEY)?.trim()
  if (!raw) return DEFAULT_API_BASE
  return raw.replace(/\/+$/, '')
}

/** `null` (or an empty string) clears the override and restores `VITE_API_BASE`. */
export function setApiBase(url: string | null): void {
  const s = storage()
  const clean = url?.trim().replace(/\/+$/, '')
  if (!clean || clean === DEFAULT_API_BASE) s?.removeItem(API_BASE_STORAGE_KEY)
  else s?.setItem(API_BASE_STORAGE_KEY, clean)
  notify(API_BASE_STORAGE_KEY)
}

export function isApiBaseOverridden(): boolean {
  return Boolean(storage()?.getItem(API_BASE_STORAGE_KEY))
}

/* ---------------------------------------------------------------- stored auth */

export function readStoredAuth(): StoredAuth | null {
  const raw = storage()?.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = storedAuthSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    if (isExpired(parsed.data)) return null
    return parsed.data
  } catch {
    return null
  }
}

export function writeStoredAuth(auth: StoredAuth): void {
  storage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  notify(AUTH_STORAGE_KEY)
}

export function clearStoredAuth(): void {
  storage()?.removeItem(AUTH_STORAGE_KEY)
  notify(AUTH_STORAGE_KEY)
}

export function isExpired(auth: StoredAuth): boolean {
  if (!auth.expires_at) return false
  const ms = Date.parse(auth.expires_at)
  return Number.isFinite(ms) && ms <= Date.now()
}

/**
 * Identity-stable snapshot for `useSyncExternalStore`: the parsed value is memoized on the
 * raw string, so repeated reads return the same object until storage actually changes.
 */
let authCache: { raw: string | null; value: StoredAuth | null } = { raw: null, value: null }

export function authSnapshot(): StoredAuth | null {
  const raw = storage()?.getItem(AUTH_STORAGE_KEY) ?? null
  if (raw !== authCache.raw) authCache = { raw, value: raw ? readStoredAuth() : null }
  return authCache.value
}

/** Bearer token for the current principal, or `null` when signed out. */
export function currentToken(): string | null {
  return readStoredAuth()?.token ?? null
}

/**
 * Authentication for the dashboard (PLAN section 4).
 *
 * Two ways in, both ending up in `localStorage["ghostmap.auth"]`:
 *  - Google Identity Services: the GIS script is loaded on demand, the returned `id_token`
 *    is posted to `POST /v1/auth/google`, and the Ghostmap token is stored with `kind: "user"`.
 *  - Admin key: the raw `ADMIN_API_KEY` is stored with `kind: "admin"`.
 *
 * Admin UI is gated on evidence, not on the stored `kind`: `GET /admin/overview` is probed
 * with the current token and only a 2xx flips `isAdmin`. A 401 from that probe means the
 * token is expired or revoked, so the session is cleared.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, errorMessage, isApiError } from './api/client'
import { queryKeys } from './api/hooks'
import type { AuthUser, StoredAuth } from './api/types'
import {
  GOOGLE_CLIENT_ID,
  authSnapshot,
  clearStoredAuth,
  getApiBase,
  subscribeConfig,
  writeStoredAuth,
} from './config'

/* ------------------------------------------------- Google Identity Services */

interface GoogleCredentialResponse {
  credential?: string
  select_by?: string
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    ux_mode?: 'popup' | 'redirect'
  }): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
  prompt(): void
  cancel(): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } }
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let gisPromise: Promise<void> | null = null

/** Injects the GIS script once per page load. */
function loadGoogleIdentity(): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('no document'))
  if (window.google?.accounts?.id) return Promise.resolve()
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => {
      gisPromise = null
      reject(new Error('Could not load Google Identity Services'))
    })
    if (!existing) document.head.appendChild(script)
  })
  return gisPromise
}

/** `{ ready }` once `window.google.accounts.id` is usable. */
export function useGoogleIdentity(): { ready: boolean; error: string | null; configured: boolean } {
  const configured = Boolean(GOOGLE_CLIENT_ID)
  const [ready, setReady] = useState<boolean>(() => Boolean(window.google?.accounts?.id))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configured || ready) return
    let cancelled = false
    loadGoogleIdentity()
      .then(() => !cancelled && setReady(true))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [configured, ready])

  return { ready, error, configured }
}

/* ------------------------------------------------------------------ context */

export type AuthStatus = 'anonymous' | 'checking' | 'user' | 'admin'

export interface AuthContextValue {
  /** The stored principal, or `null` when signed out. */
  auth: StoredAuth | null
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
  /** True only once `GET /admin/overview` has answered 2xx for this token. */
  isAdmin: boolean
  /** False while the admin probe is still in flight. */
  adminChecked: boolean
  status: AuthStatus
  /** Name for the avatar/menu: the Google profile name, else the email, else "Admin". */
  displayName: string
  /** Exchanges a Google `id_token` for a Ghostmap user token. */
  signInWithGoogle(idToken: string): Promise<StoredAuth>
  /** Verifies an admin key against `GET /admin/overview`, then stores it. */
  signInWithAdminKey(key: string): Promise<StoredAuth>
  signOut(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient()
  const auth = useSyncExternalStore(subscribeConfig, authSnapshot, () => null)
  // The API base is part of the identity of a session: a different backend means a
  // different admin key and different data.
  const apiBase = useSyncExternalStore(subscribeConfig, getApiBase, () => getApiBase())
  const token = auth?.token ?? null

  const signOut = useCallback(() => {
    try {
      window.google?.accounts.id.disableAutoSelect()
    } catch {
      /* GIS not loaded; nothing to reset */
    }
    clearStoredAuth()
    queryClient.clear()
  }, [queryClient])

  /** Evidence-based admin detection. */
  const probe = useQuery({
    queryKey: [...queryKeys.root(), 'admin', 'probe', token ?? 'anonymous'],
    queryFn: ({ signal }) => api.admin.overview(undefined, signal),
    enabled: Boolean(token),
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  // A 401 on the probe means the stored token is expired or revoked (403 just means
  // "authenticated, but not an admin", which is the normal case for Google users).
  const probeError = probe.error
  useEffect(() => {
    if (probeError instanceof ApiError && probeError.isAuthError) signOut()
  }, [probeError, signOut])

  const signInWithGoogle = useCallback(
    async (idToken: string): Promise<StoredAuth> => {
      const res = await api.auth.google({ id_token: idToken })
      if (!res.token) throw new ApiError('invalid_response', 'The backend did not return a token', 200)
      const stored: StoredAuth = {
        kind: 'admin' === res.role ? 'admin' : 'user',
        token: res.token,
        ...(res.user ? { user: res.user } : {}),
        ...(res.expiresAt ? { expires_at: res.expiresAt } : {}),
      }
      queryClient.clear()
      writeStoredAuth(stored)
      return stored
    },
    [queryClient],
  )

  const signInWithAdminKey = useCallback(
    async (key: string): Promise<StoredAuth> => {
      const trimmed = key.trim()
      if (!trimmed) throw new ApiError('bad_request', 'Enter an admin key', 400)
      try {
        await api.admin.overview(trimmed)
      } catch (e) {
        if (isApiError(e) && (e.isAuthError || e.isForbidden)) {
          throw new ApiError(e.code, 'That admin key was rejected by the backend.', e.status)
        }
        throw e
      }
      const stored: StoredAuth = { kind: 'admin', token: trimmed }
      queryClient.clear()
      writeStoredAuth(stored)
      return stored
    },
    [queryClient],
  )

  const value = useMemo<AuthContextValue>(() => {
    const isAuthenticated = Boolean(token)
    const isAdmin = isAuthenticated && probe.isSuccess
    const adminChecked = !isAuthenticated || probe.isSuccess || probe.isError
    const user = auth?.user ?? null
    const status: AuthStatus = !isAuthenticated
      ? 'anonymous'
      : !adminChecked
        ? 'checking'
        : isAdmin
          ? 'admin'
          : 'user'
    return {
      auth,
      user,
      token,
      isAuthenticated,
      isAdmin,
      adminChecked,
      status,
      displayName: user?.name || user?.email || (auth?.kind === 'admin' ? 'Admin' : 'Signed in'),
      signInWithGoogle,
      signInWithAdminKey,
      signOut,
    }
    // `apiBase` participates so a base change re-derives the whole context.
  }, [auth, token, probe.isSuccess, probe.isError, signInWithGoogle, signInWithAdminKey, signOut, apiBase])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/* -------------------------------------------------------------- GIS button */

export interface GoogleSignInButtonProps {
  onSuccess?: (auth: StoredAuth) => void
  onError?: (message: string) => void
  /** GIS button theme; the dashboard is dark, so `filled_black` is the default. */
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'small' | 'medium' | 'large'
  text?: 'signin_with' | 'signup_with' | 'continue_with'
  width?: number
}

/**
 * Renders the official Google button and exchanges the returned `id_token` with the
 * backend. Shows a short explanation instead of the button when `VITE_GOOGLE_CLIENT_ID`
 * is not set, so a fresh clone still works with the admin key alone.
 */
export function GoogleSignInButton({
  onSuccess,
  onError,
  theme = 'filled_black',
  size = 'large',
  text = 'signin_with',
  width = 280,
}: GoogleSignInButtonProps): JSX.Element {
  const { ready, error, configured } = useGoogleIdentity()
  const { signInWithGoogle } = useAuth()
  const host = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Keep the latest callbacks without re-rendering the GIS button.
  const handlers = useRef({ onSuccess, onError, signInWithGoogle })
  handlers.current = { onSuccess, onError, signInWithGoogle }

  useEffect(() => {
    if (!ready || !configured || !host.current) return
    const id = window.google?.accounts.id
    if (!id) return
    id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      cancel_on_tap_outside: true,
      callback: (response) => {
        const credential = response.credential
        if (!credential) {
          setFailure('Google did not return a credential')
          handlers.current.onError?.('Google did not return a credential')
          return
        }
        setBusy(true)
        setFailure(null)
        handlers.current
          .signInWithGoogle(credential)
          .then((stored) => handlers.current.onSuccess?.(stored))
          .catch((e: unknown) => {
            const msg = errorMessage(e)
            setFailure(msg)
            handlers.current.onError?.(msg)
          })
          .finally(() => setBusy(false))
      },
    })
    id.renderButton(host.current, { theme, size, text, shape: 'pill', width, logo_alignment: 'center' })
  }, [ready, configured, theme, size, text, width])

  if (!configured) {
    return (
      <p className="rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 text-xs text-ink-400">
        Google sign-in is not configured. Set <code className="text-ink-300">VITE_GOOGLE_CLIENT_ID</code> to enable it.
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={host} aria-busy={busy} data-testid="google-signin" className="min-h-[44px]" />
      {!ready && !error ? <p className="text-xs text-ink-400">Loading Google sign-in…</p> : null}
      {busy ? <p className="text-xs text-ink-400">Signing in…</p> : null}
      {(error ?? failure) ? <p className="text-xs text-red-400">{error ?? failure}</p> : null}
    </div>
  )
}

/* ----------------------------------------------------------- admin key form */

export interface AdminKeyFormProps {
  onSuccess?: (auth: StoredAuth) => void
}

/** The "admin key" box from PLAN section 4: stores `ADMIN_API_KEY` as the bearer token. */
export function AdminKeyForm({ onSuccess }: AdminKeyFormProps): JSX.Element {
  const { signInWithAdminKey } = useAuth()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        signInWithAdminKey(key)
          .then((stored) => {
            setKey('')
            onSuccess?.(stored)
          })
          .catch((err: unknown) => setError(errorMessage(err)))
          .finally(() => setBusy(false))
      }}
    >
      <label className="label" htmlFor="admin-key">
        Admin key
      </label>
      <input
        id="admin-key"
        name="admin-key"
        type="password"
        autoComplete="off"
        className="input font-mono"
        placeholder="ADMIN_API_KEY"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button type="submit" className="btn-secondary" disabled={busy || !key.trim()}>
        {busy ? 'Checking…' : 'Continue with admin key'}
      </button>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <p className="text-[11px] leading-relaxed text-ink-500">
        The key is kept in this browser only (localStorage) and sent as a bearer token to{' '}
        <code>{getApiBase()}</code>.
      </p>
    </form>
  )
}

/**
 * /login — Google Identity Services button plus the admin-key box (PLAN section 4).
 * Signing in returns the visitor to wherever they were headed (a shared /join/<code> link,
 * an admin page), which is passed through router state by `ProtectedRoute`.
 */
import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Map as MapIcon } from 'lucide-react'
import { AdminKeyForm, GoogleSignInButton, useAuth } from '../lib/auth'
import { getApiBase } from '../lib/config'

export function LoginPage(): JSX.Element {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: string } | null
  const from = state?.from && state.from !== '/login' ? state.from : '/'

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true })
  }, [isAuthenticated, from, navigate])

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ghost-600/20 text-ghost-400">
            <MapIcon className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-white">Sign in to Ghostmap</h1>
          <p className="text-sm text-ink-400">
            Your maps and mapping parties, live from the phones that captured them.
          </p>
        </div>

        <div className="card flex flex-col gap-5 p-5">
          <GoogleSignInButton onSuccess={() => navigate(from, { replace: true })} />

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-ink-500">
            <span className="h-px flex-1 bg-ink-800" />
            or
            <span className="h-px flex-1 bg-ink-800" />
          </div>

          <AdminKeyForm onSuccess={() => navigate(from, { replace: true })} />
        </div>

        <p className="mt-4 text-center text-xs text-ink-500">
          Backend <code className="text-ink-400">{getApiBase()}</code> ·{' '}
          <Link to="/settings" className="text-ghost-400 hover:underline">
            change
          </Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage

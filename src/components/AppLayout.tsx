/**
 * Application chrome: top bar with the primary navigation and the signed-in user, a bottom
 * tab bar on phones, and the lazily loaded route inside a Suspense boundary.
 */
import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogIn, LogOut, Map as MapIcon, Settings as SettingsIcon, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useHealth } from '../lib/api/hooks'
import { LoadingState } from './ui'

interface NavItem {
  to: string
  label: string
  icon: typeof MapIcon
  end?: boolean
}

const BASE_NAV: NavItem[] = [
  { to: '/', label: 'Maps', icon: MapIcon, end: true },
  { to: '/parties', label: 'Parties', icon: Users },
]

const ADMIN_NAV: NavItem = { to: '/admin', label: 'Admin', icon: ShieldCheck }
const SETTINGS_NAV: NavItem = { to: '/settings', label: 'Settings', icon: SettingsIcon }

/** Small dot showing whether `GET /health` is answering. */
function HealthDot(): JSX.Element {
  const { data, isPending, isError } = useHealth({ refetchInterval: 60_000, staleTime: 30_000 })
  const tone = isPending ? 'bg-ink-500' : isError || !data?.ok ? 'bg-red-500' : 'bg-emerald-500'
  const title = isPending
    ? 'Checking the backend…'
    : isError
      ? 'Backend unreachable'
      : `Backend ${data?.version || 'ok'}${data?.region ? ` · ${data.region}` : ''}`
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-400" title={title}>
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden />
      <span className="hidden sm:inline">{isError ? 'offline' : (data?.region ?? 'api')}</span>
    </span>
  )
}

function UserMenu(): JSX.Element {
  const { isAuthenticated, user, displayName, auth, signOut } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return (
      <NavLink
        to="/login"
        state={{ from: `${location.pathname}${location.search}` }}
        className="btn-secondary px-2.5 py-1.5 text-xs"
      >
        <LogIn className="h-3.5 w-3.5" aria-hidden />
        Sign in
      </NavLink>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-medium leading-tight text-ink-200">{displayName}</p>
        <p className="text-[11px] leading-tight text-ink-500">{auth?.kind === 'admin' ? 'admin key' : 'Google account'}</p>
      </div>
      {user?.pictureUrl ? (
        <img
          src={user.pictureUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-7 w-7 rounded-full border border-ink-700 object-cover"
        />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-[11px] font-semibold text-ink-300">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <button type="button" className="btn-ghost px-2 py-1.5" onClick={signOut} title="Sign out" aria-label="Sign out">
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
    isActive ? 'bg-ink-800 text-white' : 'text-ink-300 hover:bg-ink-850 hover:text-white',
  ].join(' ')
}

export function AppLayout(): JSX.Element {
  const { isAdmin } = useAuth()
  const items: NavItem[] = [...BASE_NAV, ...(isAdmin ? [ADMIN_NAV] : []), SETTINGS_NAV]

  return (
    <div className="flex min-h-full flex-col bg-ink-950">
      <header className="sticky top-0 z-20 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ghost-600/20 text-ghost-400" aria-hidden>
              <MapIcon className="h-4 w-4" />
            </span>
            Ghostmap
          </NavLink>

          <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
            {items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={navClass}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <HealthDot />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 md:pb-10">
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </main>

      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                isActive ? 'text-ghost-400' : 'text-ink-400'
              }`
            }
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default AppLayout

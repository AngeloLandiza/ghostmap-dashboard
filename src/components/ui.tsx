/** Shared presentational pieces: headers, states, tiles and the page-stub scaffold. */
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ApiError, errorMessage } from '../lib/api/client'

export function Spinner({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={`card p-4 ${className}`}>{children}</div>
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}): JSX.Element {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'
}): JSX.Element {
  const tones: Record<string, string> = {
    neutral: 'border-ink-700 bg-ink-850 text-ink-300',
    good: 'border-emerald-800/70 bg-emerald-950/60 text-emerald-300',
    warn: 'border-amber-800/70 bg-amber-950/60 text-amber-300',
    bad: 'border-red-900/70 bg-red-950/60 text-red-300',
    info: 'border-ghost-700/70 bg-ghost-700/20 text-ghost-300',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tones[tone] ?? tones.neutral}`}>
      {children}
    </span>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-400">
      <Spinner />
      {label}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description ? <p className="max-w-md text-sm text-ink-400">{description}</p> : null}
      {action}
    </div>
  )
}

/** Renders any thrown value, with a friendlier line for the common API failures. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element {
  const api = error instanceof ApiError ? error : null
  const title = api?.isNetworkError
    ? 'Cannot reach the backend'
    : api?.isAuthError
      ? 'Sign in again'
      : api?.isForbidden
        ? 'Not allowed'
        : api?.isNotConfigured
          ? 'Not configured on the backend'
          : 'Something went wrong'
  return (
    <div className="card flex flex-col items-start gap-2 border-red-900/40 bg-red-950/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-red-300">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {title}
      </div>
      <p className="text-sm text-ink-300">{errorMessage(error)}</p>
      {api ? (
        <p className="font-mono text-[11px] text-ink-500">
          {api.code}
          {api.status ? ` · HTTP ${api.status}` : ''}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn-secondary mt-1" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

/**
 * Placeholder body for a route that is scaffolded but not implemented yet. Each page owned
 * by a later agent renders one of these with its checklist, so the app is navigable from
 * the first commit and nobody has to guess what a route is supposed to contain.
 */
export function PageStub({
  planRef,
  todos,
  children,
}: {
  planRef: string
  todos: string[]
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {children}
      <div className="card p-4">
        <p className="text-xs uppercase tracking-wide text-ink-400">Scaffold · {planRef}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {todos.map((todo) => (
            <li key={todo} className="flex items-start gap-2 text-sm text-ink-300">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ghost-500" aria-hidden />
              {todo}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

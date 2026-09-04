/**
 * Small building blocks shared by the admin pages: a panel shell, and the loading /
 * error / "not configured" states every admin query can be in.
 *
 * `501 not_configured` is a normal answer here, not a failure: the backend is deployed
 * feature by feature (BigQuery billing export, New Relic, GCS, Ably...), so a page that
 * asks for something not wired up yet explains which setup guide turns it on instead of
 * showing a red error.
 */
import type { ReactNode } from 'react'
import { BookOpen, PlugZap } from 'lucide-react'
import { ApiError } from '../../lib/api/client'
import { ErrorState, LoadingState } from '../ui'

/* ------------------------------------------------------------------ setup docs */

const DOCS_BASE = 'https://github.com/AngeloLandiza/ghostmap-backend/blob/main/docs/setup'

/** The backend setup guides a `not_configured` answer can point at. */
export const SETUP_DOCS = {
  vercel: { href: `${DOCS_BASE}/01-vercel-and-auth.md`, label: 'Setup guide 1 · Vercel and auth' },
  database: { href: `${DOCS_BASE}/02-neon-postgres.md`, label: 'Setup guide 2 · Neon Postgres' },
  storage: { href: `${DOCS_BASE}/03-google-cloud-storage.md`, label: 'Setup guide 3 · Cloud Storage' },
  ably: { href: `${DOCS_BASE}/04-ably-realtime.md`, label: 'Setup guide 4 · Ably realtime' },
  monitoring: {
    href: `${DOCS_BASE}/07-admin-monitoring-newrelic.md`,
    label: 'Setup guide 7 · Costs, storage and New Relic',
  },
} as const

export type SetupDoc = keyof typeof SETUP_DOCS

/* ---------------------------------------------------------------------- panel */

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`card p-4 ${className}`}>
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------ not configured */

export function NotConfiguredCard({
  feature,
  doc,
  message,
}: {
  /** What the backend could not answer for, e.g. "The BigQuery billing export". */
  feature: string
  doc: SetupDoc
  /** The backend's own explanation, when it sent one. */
  message?: string
}): JSX.Element {
  const { href, label } = SETUP_DOCS[doc]
  return (
    <div className="card flex flex-col items-start gap-2 border-amber-900/40 bg-amber-950/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
        <PlugZap className="h-4 w-4" aria-hidden />
        {feature} is not configured on this backend
      </div>
      <p className="text-sm text-ink-300">
        {message || 'The endpoint answered 501 not_configured, so there is nothing to show yet.'}
      </p>
      <a
        className="btn-secondary mt-1 text-xs"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
      >
        <BookOpen className="h-3.5 w-3.5" aria-hidden />
        {label}
      </a>
    </div>
  )
}

/** True when a thrown value is the backend's `501 not_configured`. */
export function isNotConfigured(error: unknown): boolean {
  return error instanceof ApiError && error.isNotConfigured
}

/* ----------------------------------------------------------------- query state */

export interface QueryStateProps {
  isPending: boolean
  isError: boolean
  error: unknown
  refetch?: () => unknown
  loadingLabel?: string
  /** Turns a 501 into an explanatory card instead of an error. */
  notConfigured?: { feature: string; doc: SetupDoc }
}

/**
 * Renders whichever of loading / not-configured / error applies, or `null` when the query
 * has data to show. Pages call it above their content so the happy path stays readable.
 */
export function QueryState({
  isPending,
  isError,
  error,
  refetch,
  loadingLabel,
  notConfigured,
}: QueryStateProps): JSX.Element | null {
  if (isPending) return <LoadingState label={loadingLabel} />
  if (!isError) return null
  if (notConfigured && isNotConfigured(error)) {
    return (
      <NotConfiguredCard
        feature={notConfigured.feature}
        doc={notConfigured.doc}
        {...(error instanceof ApiError && error.message ? { message: error.message } : {})}
      />
    )
  }
  return <ErrorState error={error} {...(refetch ? { onRetry: () => void refetch() } : {})} />
}

/* ---------------------------------------------------------------- misc pieces */

/** A labelled row used inside panels for short key/value pairs. */
export function KeyValue({ label, value }: { label: ReactNode; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-800/70 py-1.5 last:border-0">
      <span className="text-xs text-ink-400">{label}</span>
      <span className="text-sm tabular-nums text-ink-200">{value}</span>
    </div>
  )
}

/** External link to a provider's pricing page, shown next to prices. */
export function SourceLink({ href, asOf }: { href?: string | null; asOf?: string | null }): JSX.Element {
  if (!href) return <span className="text-ink-600">—</span>
  return (
    <a
      className="text-ghost-400 underline decoration-ink-600 underline-offset-2 hover:text-ghost-300"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={asOf ? `Checked ${asOf}` : undefined}
    >
      source
    </a>
  )
}

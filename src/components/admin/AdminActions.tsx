/**
 * The two maintenance actions on `/admin`: push the metric snapshot to New Relic
 * (`POST /admin/newrelic/push`, the same job Vercel Cron runs daily) and apply the bundled
 * schema (`POST /admin/db/migrate`, idempotent).
 */
import type { ReactNode } from 'react'
import { Database, Send } from 'lucide-react'
import { ApiError, errorMessage } from '../../lib/api/client'
import { useDbMigrate, useNewRelicPush } from '../../lib/api/hooks'
import { Spinner } from '../ui'
import { SETUP_DOCS, isNotConfigured } from './AdminUi'
import { formatNumber } from '../../lib/format'

function Result({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }): JSX.Element {
  const tones = {
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-red-300',
  } as const
  return <p className={`text-xs ${tones[tone]}`}>{children}</p>
}

/** Turns a failed mutation into a line, with a setup link when the feature is off. */
function MutationError({ error, doc }: { error: unknown; doc: keyof typeof SETUP_DOCS }): JSX.Element {
  if (isNotConfigured(error)) {
    const { href, label } = SETUP_DOCS[doc]
    return (
      <Result tone="warn">
        Not configured on this backend.{' '}
        <a className="underline underline-offset-2" href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>
      </Result>
    )
  }
  const status = error instanceof ApiError && error.status ? ` (HTTP ${error.status})` : ''
  return (
    <Result tone="bad">
      {errorMessage(error)}
      {status}
    </Result>
  )
}

export function AdminActions(): JSX.Element {
  const push = useNewRelicPush()
  const migrate = useDbMigrate()

  const runMigrate = (): void => {
    const ok = window.confirm(
      'Apply the bundled schema to the database?\n\nEvery statement is CREATE ... IF NOT EXISTS, so this is safe to re-run, but it does write to the production database.',
    )
    if (ok) migrate.mutate()
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex flex-1 flex-col gap-1.5">
        <button
          type="button"
          className="btn-secondary w-full justify-start sm:w-auto"
          onClick={() => push.mutate()}
          disabled={push.isPending}
        >
          {push.isPending ? <Spinner /> : <Send className="h-4 w-4" aria-hidden />}
          Push metrics to New Relic
        </button>
        {push.isSuccess ? (
          push.data.sent ? (
            <Result tone="good">
              Sent {formatNumber(push.data.metrics)} metrics and a GhostmapSnapshot event.
            </Result>
          ) : (
            <Result tone="warn">Nothing sent{push.data.reason ? `: ${push.data.reason}` : '.'}</Result>
          )
        ) : null}
        {push.isError ? <MutationError error={push.error} doc="monitoring" /> : null}
        {!push.isPending && !push.isSuccess && !push.isError ? (
          <p className="text-xs text-ink-500">Cron runs this daily; use it to refresh the dashboards now.</p>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <button
          type="button"
          className="btn-secondary w-full justify-start sm:w-auto"
          onClick={runMigrate}
          disabled={migrate.isPending}
        >
          {migrate.isPending ? <Spinner /> : <Database className="h-4 w-4" aria-hidden />}
          Run database migration
        </button>
        {migrate.isSuccess ? (
          <Result tone="good">
            Schema applied · {formatNumber(migrate.data.statements)} statements.
          </Result>
        ) : null}
        {migrate.isError ? <MutationError error={migrate.error} doc="database" /> : null}
        {!migrate.isPending && !migrate.isSuccess && !migrate.isError ? (
          <p className="text-xs text-ink-500">Idempotent: creates anything the deployment is missing.</p>
        ) : null}
      </div>
    </div>
  )
}

export default AdminActions

/**
 * Deep health checks from `GET /admin/health`: database, GCP credentials, Ably and
 * New Relic. Unknown checks the backend adds later are rendered too, so this panel does not
 * need a change every time a dependency is added.
 */
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import type { AdminHealth } from '../../lib/api/types'
import { SETUP_DOCS, type SetupDoc } from './AdminUi'

interface CheckMeta {
  label: string
  doc: SetupDoc
}

/** Known checks, in the order they are shown. */
const CHECK_META: Record<string, CheckMeta> = {
  database: { label: 'Database · Neon Postgres', doc: 'database' },
  gcp: { label: 'Google Cloud · storage and BigQuery', doc: 'storage' },
  ably: { label: 'Ably · realtime', doc: 'ably' },
  newrelic: { label: 'New Relic · monitoring', doc: 'monitoring' },
}

const ORDER = Object.keys(CHECK_META)

interface Check {
  key: string
  ok: boolean
  detail: string | null
}

/** Reads a check defensively: anything that is not `{ ok, detail }` is skipped. */
function readCheck(key: string, value: unknown): Check | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!('ok' in record)) return null
  return {
    key,
    ok: record.ok === true,
    detail: typeof record.detail === 'string' && record.detail ? record.detail : null,
  }
}

export function checksOf(health: AdminHealth | undefined): Check[] {
  const raw = (health?.checks ?? {}) as Record<string, unknown>
  const parsed = Object.entries(raw)
    .map(([key, value]) => readCheck(key, value))
    .filter((c): c is Check => c !== null)
  return parsed.sort((a, b) => {
    const ai = ORDER.indexOf(a.key)
    const bi = ORDER.indexOf(b.key)
    return (ai === -1 ? ORDER.length : ai) - (bi === -1 ? ORDER.length : bi)
  })
}

export function HealthPanel({ health }: { health: AdminHealth | undefined }): JSX.Element {
  const checks = checksOf(health)

  if (checks.length === 0) {
    return <p className="py-4 text-center text-sm text-ink-500">The backend reported no health checks.</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {checks.map((check) => {
        const meta = CHECK_META[check.key]
        const doc = meta ? SETUP_DOCS[meta.doc] : null
        return (
          <li
            key={check.key}
            className="flex items-start gap-2.5 rounded-lg border border-ink-800/70 bg-ink-950/40 px-3 py-2.5"
          >
            {check.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-100">{meta?.label ?? check.key}</p>
              <p className="truncate text-xs text-ink-500" title={check.detail ?? undefined}>
                {check.detail ?? (check.ok ? 'ok' : 'unavailable')}
              </p>
            </div>
            {!check.ok && doc ? (
              <a
                className="shrink-0 text-xs text-ghost-400 hover:text-ghost-300"
                href={doc.href}
                target="_blank"
                rel="noreferrer noopener"
                title={doc.label}
              >
                <span className="inline-flex items-center gap-1">
                  setup
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </span>
              </a>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export default HealthPanel

/**
 * /settings — runtime configuration. The API base override lives in localStorage so a
 * single deployment of this dashboard can point at production, a preview deployment or a
 * local `vercel dev` without a rebuild.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { PageHeader, StatTile } from '../components/ui'
import { api, errorMessage } from '../lib/api/client'
import { useAuth } from '../lib/auth'
import {
  DEFAULT_API_BASE,
  GOOGLE_CLIENT_ID,
  getApiBase,
  isApiBaseOverridden,
  setApiBase,
} from '../lib/config'
import type { Health } from '../lib/api/types'

export function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient()
  const { auth, displayName, isAdmin, adminChecked, isAuthenticated, signOut } = useAuth()
  const [value, setValue] = useState(() => getApiBase())
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const current = getApiBase()
  const dirty = value.replace(/\/+$/, '') !== current

  function save(next: string | null): void {
    setApiBase(next)
    const applied = getApiBase()
    setValue(applied)
    // Cached rows belong to the previous backend; drop them rather than mixing worlds.
    queryClient.clear()
    setSaved(true)
    setTestResult(null)
    window.setTimeout(() => setSaved(false), 2000)
  }

  async function test(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const health: Health = await api.health()
      setTestResult({
        ok: Boolean(health.ok),
        message: `ok · ${health.version || 'unknown version'}${health.region ? ` · ${health.region}` : ''}`,
      })
    } catch (e) {
      setTestResult({ ok: false, message: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Where this dashboard talks to, and who it talks as." />

      <section className="card p-4">
        <h2 className="text-sm font-semibold text-white">Backend</h2>
        <p className="mt-1 text-sm text-ink-400">
          Stored in this browser only. Leave it as the default unless you are testing a preview deployment.
        </p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save(value)
          }}
        >
          <div>
            <label className="label" htmlFor="api-base">
              API base URL
            </label>
            <input
              id="api-base"
              className="input font-mono"
              value={value}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
              onChange={(e) => setValue(e.target.value)}
              placeholder={DEFAULT_API_BASE}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary" disabled={!dirty}>
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => save(null)}
              disabled={!isApiBaseOverridden()}
            >
              Reset to default
            </button>
            <button type="button" className="btn-ghost" onClick={() => void test()} disabled={testing}>
              <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} aria-hidden />
              Test connection
            </button>
            {saved ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                Saved
              </span>
            ) : null}
          </div>
          {testResult ? (
            <p className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{testResult.message}</p>
          ) : null}
          <p className="text-xs text-ink-500">
            Default from <code>VITE_API_BASE</code>: <code className="text-ink-400">{DEFAULT_API_BASE}</code>
          </p>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Signed in as" value={isAuthenticated ? displayName : 'Nobody'} hint={auth?.user?.email ?? undefined} />
        <StatTile
          label="Credential"
          value={auth ? (auth.kind === 'admin' ? 'Admin key' : 'Google account') : '—'}
          hint={auth?.expires_at ? `expires ${new Date(auth.expires_at).toLocaleString()}` : undefined}
        />
        <StatTile
          label="Admin access"
          value={!isAuthenticated ? '—' : !adminChecked ? 'Checking…' : isAdmin ? 'Yes' : 'No'}
          hint="Probed with GET /admin/overview"
        />
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold text-white">Google sign-in</h2>
        <p className="mt-1 text-sm text-ink-400">
          {GOOGLE_CLIENT_ID ? (
            <>
              Configured with client id <code className="text-ink-300">{GOOGLE_CLIENT_ID.slice(0, 24)}…</code>. The same
              id must appear in the backend&apos;s <code>GOOGLE_CLIENT_IDS</code>.
            </>
          ) : (
            <>
              Not configured. Set <code className="text-ink-300">VITE_GOOGLE_CLIENT_ID</code> to show the Google button
              on /login.
            </>
          )}
        </p>
      </section>

      {isAuthenticated ? (
        <section className="card p-4">
          <h2 className="text-sm font-semibold text-white">Session</h2>
          <p className="mt-1 text-sm text-ink-400">
            Signing out clears the stored token and every cached response in this browser.
          </p>
          <button type="button" className="btn-danger mt-3" onClick={signOut}>
            Sign out
          </button>
        </section>
      ) : null}
    </div>
  )
}

export default SettingsPage

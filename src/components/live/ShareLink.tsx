/**
 * The party share link (PLAN section 2: `${DASHBOARD_URL}/join/<code>`) and a copy button.
 *
 * The backend derives `share_url` from its own `DASHBOARD_URL`, which may point at the
 * production deployment while you are on localhost, so the invite code always wins when we can
 * rebuild the link against the origin the viewer is actually on.
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { formatInviteCode, normalizeInviteCode } from '../../lib/format'

export interface ShareTarget {
  inviteCode?: string | null
  shareUrl?: string | null
}

/** Absolute `/join/<code>` URL for this party, or `null` when it has no invite code. */
export function shareUrlFor(target: ShareTarget | null | undefined): string | null {
  const code = normalizeInviteCode(target?.inviteCode)
  if (code && typeof window !== 'undefined') return `${window.location.origin}/join/${code}`
  if (target?.shareUrl) return target.shareUrl
  return code ? `/join/${code}` : null
}

export function CopyButton({
  value,
  label = 'Copy link',
  className = 'btn-secondary px-2.5 py-1.5 text-xs',
}: {
  value: string
  label?: string
  className?: string
}): JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = useCallback(() => {
    const done = () => setCopied(true)
    // `navigator.clipboard` needs a secure context; the textarea path keeps http://<lan-ip> working.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => fallbackCopy(value, done))
    } else {
      fallbackCopy(value, done)
    }
  }, [value])

  return (
    <button type="button" className={className} onClick={copy} title={value}>
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function fallbackCopy(value: string, done: () => void): void {
  try {
    const el = document.createElement('textarea')
    el.value = value
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    done()
  } catch {
    /* clipboard unavailable; the title attribute still shows the link */
  }
}

/** Monospace invite code plus a copy-the-link button. */
export function InviteCodeChip({ target }: { target: ShareTarget }): JSX.Element | null {
  const code = normalizeInviteCode(target.inviteCode)
  const url = shareUrlFor(target)
  if (!code) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded border border-ink-700 bg-ink-950/60 px-1.5 py-0.5 font-mono text-xs tracking-wider text-ink-200">
        {formatInviteCode(code)}
      </code>
      {url ? <CopyButton value={url} label="Copy link" className="btn-ghost px-1.5 py-1 text-[11px]" /> : null}
    </span>
  )
}

/**
 * Participants panel for the live party view (PLAN section 4): colour dot, display name, kind,
 * presence and the per-device keyframe/point counts.
 *
 * Two sources are reconciled here. The participant *rows* come from `GET /v1/sessions/:id` and
 * the `participant` realtime events — they say who belongs to the party. Ably *presence* says
 * who has a tab or a phone open right now; a member with no presence entry is simply offline,
 * which is different from having left.
 */
import { Smartphone, Eye, Crown } from 'lucide-react'
import type { SessionParticipant } from '../../lib/api/types'
import type { PresenceEntry } from '../../lib/realtime/useLiveParty'
import type { LiveStats } from '../../lib/realtime/liveStore'
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format'
import { Badge } from '../ui'

export function ColorDot({ color, muted = false }: { color: string; muted?: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      className={`h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/30 ${muted ? 'opacity-40' : ''}`}
      style={{ backgroundColor: color || '#6b7280' }}
    />
  )
}

export interface ParticipantsPanelProps {
  participants: readonly SessionParticipant[]
  presence: readonly PresenceEntry[]
  stats: LiveStats
  maxParticipants: number
  /** Our own participant row id, so "you" is marked. */
  meId?: string | null
}

/** True when this member has a live connection on the channel. */
function onlineMatcher(presence: readonly PresenceEntry[]): (p: SessionParticipant) => boolean {
  const userIds = new Set<string>()
  const clientIds = new Set<string>()
  for (const entry of presence) {
    if (entry.userId) userIds.add(entry.userId)
    if (entry.clientId) clientIds.add(entry.clientId)
  }
  return (p) => {
    if (p.userId && userIds.has(p.userId)) return true
    if (p.deviceId && clientIds.has(p.deviceId)) return true
    if (p.userId && clientIds.has(p.userId)) return true
    return false
  }
}

export function ParticipantsPanel({
  participants,
  presence,
  stats,
  maxParticipants,
  meId,
}: ParticipantsPanelProps): JSX.Element {
  const isOnline = onlineMatcher(presence)
  const byDevice = new Map(stats.devices.map((d) => [d.deviceId, d]))
  const active = participants.filter((p) => !p.leftAt)
  const rows = [...participants].sort((a, b) => {
    if (Boolean(a.leftAt) !== Boolean(b.leftAt)) return a.leftAt ? 1 : -1
    return (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '')
  })

  // Anyone on the channel who is not one of the rows above (an admin watching, say).
  const known = new Set<string>()
  for (const p of participants) {
    if (p.userId) known.add(p.userId)
    if (p.deviceId) known.add(p.deviceId)
  }
  const extraWatchers = presence.filter((e) => !(e.userId && known.has(e.userId)) && !known.has(e.clientId))

  return (
    <section className="card p-4" aria-label="Participants">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Participants</h2>
        <span className="text-xs tabular-nums text-ink-400">
          {active.length}/{maxParticipants || 4}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-400">Nobody has joined yet. Share the invite code to fill the party.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-ink-800">
          {rows.map((p) => {
            const left = Boolean(p.leftAt)
            const online = !left && isOnline(p)
            const device = p.deviceId ? byDevice.get(p.deviceId) : undefined
            const isDevice = p.kind !== 'viewer'
            return (
              <li
                key={p.id || `${p.deviceId}-${p.userId}`}
                data-testid="participant-row"
                data-participant-kind={p.kind}
                data-left={left}
                className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="mt-1 flex items-center gap-1.5">
                  <ColorDot color={p.color} muted={left} />
                  <span
                    title={left ? 'Left the party' : online ? 'Connected' : 'Not connected'}
                    className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-ink-600'}`}
                    aria-hidden
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${left ? 'text-ink-500 line-through' : 'text-ink-100'}`}>
                    {p.displayName || (isDevice ? 'Phone' : 'Viewer')}
                    {meId && p.id === meId ? <span className="ml-1.5 text-xs text-ink-500">(you)</span> : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
                    <span className="inline-flex items-center gap-1">
                      {isDevice ? <Smartphone className="h-3 w-3" aria-hidden /> : <Eye className="h-3 w-3" aria-hidden />}
                      {isDevice ? 'mapper' : 'viewer'}
                    </span>
                    {p.role === 'leader' ? (
                      <span className="inline-flex items-center gap-1 text-amber-400/80">
                        <Crown className="h-3 w-3" aria-hidden />
                        leader
                      </span>
                    ) : null}
                    <span title={formatDateTime(p.joinedAt)}>joined {formatRelative(p.joinedAt)}</span>
                    {left ? <span title={formatDateTime(p.leftAt)}>left {formatRelative(p.leftAt)}</span> : null}
                  </p>
                  {device && device.keyframes > 0 ? (
                    <p className="mt-1 text-[11px] tabular-nums text-ink-400">
                      {formatNumber(device.keyframes)} keyframes · {formatNumber(device.points, true)} points
                      {device.unaligned > 0 ? ` · ${formatNumber(device.unaligned)} unaligned` : ''}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {extraWatchers.length > 0 ? (
        <div className="mt-3 border-t border-ink-800 pt-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-500">Also watching</p>
          <ul className="flex flex-wrap gap-1.5">
            {extraWatchers.map((e) => (
              <li key={e.clientId || e.displayName}>
                <Badge>
                  <ColorDot color={e.color} />
                  {e.displayName}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

export default ParticipantsPanel

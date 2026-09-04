/**
 * `/parties/:id` — the live party view (PLAN sections 2 and 4).
 *
 * Three things run at once here: the session query (participants, status, share link), the
 * realtime pump in {@link useLiveParty} (REST catch-up, Ably subscription, presence), and the
 * lazily loaded three.js scene that reads the pump's buffers every frame. Only the counters and
 * the participant list flow through React state.
 */
import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, LogIn, LogOut, Radio, Square } from 'lucide-react'
import LiveStatsBar from '../../components/live/LiveStatsBar'
import ParticipantsPanel from '../../components/live/ParticipantsPanel'
import { CopyButton, shareUrlFor } from '../../components/live/ShareLink'
import { Badge, Card, ErrorState, LoadingState, PageHeader, Spinner } from '../../components/ui'
import { errorMessage } from '../../lib/api/client'
import { useEndSession, useJoinSessionById, useLeaveSession, useSession } from '../../lib/api/hooks'
import { useAuth } from '../../lib/auth'
import { formatInviteCode, formatNumber } from '../../lib/format'
import { useLiveParty } from '../../lib/realtime/useLiveParty'

// three.js and @react-three/fiber load only once someone opens a live party.
const PartyScene = lazy(() => import('../../components/live/PartyScene'))

function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'bad' | 'info'
  children: ReactNode
}): JSX.Element {
  const tones = {
    warn: 'border-amber-900/60 bg-amber-950/30 text-amber-200',
    bad: 'border-red-900/50 bg-red-950/30 text-red-200',
    info: 'border-ghost-700/50 bg-ghost-700/10 text-ghost-200',
  } as const
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}

export function PartyLivePage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()

  const sessionQuery = useSession(id, { refetchInterval: 60_000 })
  const session = sessionQuery.data?.session
  const participants = sessionQuery.data?.participants ?? []

  const leave = useLeaveSession()
  const end = useEndSession()
  const join = useJoinSessionById()

  const [paused, setPaused] = useState(false)
  const [showTrajectories, setShowTrajectories] = useState(true)
  const [showFrustums, setShowFrustums] = useState(true)
  const [recenterToken, setRecenterToken] = useState(0)

  const me = useMemo(
    () => participants.find((p) => p.userId && user?.id && p.userId === user.id && !p.leftAt) ?? null,
    [participants, user?.id],
  )

  const live = useLiveParty({
    sessionId: id,
    participants,
    channelName: sessionQuery.data?.channel || null,
    me,
    // Wait for the participant list: colours have to be known before catch-up tints any points.
    enabled: sessionQuery.isSuccess,
  })

  if (sessionQuery.isPending) return <LoadingState label="Loading party…" />
  if (sessionQuery.isError) return <ErrorState error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />

  const ended = live.ended || session?.status === 'ended' || session?.status === 'merged'
  const shareUrl = shareUrlFor(session)
  const max = session?.maxParticipants || 4
  const canEnd = Boolean(isAdmin || (user?.id && session?.ownerUserId && session.ownerUserId === user.id))
  const unaligned = live.stats.devices.reduce((n, d) => n + d.unaligned, 0)

  const doLeave = (): void => {
    if (!id) return
    leave.mutate(id, { onSuccess: () => navigate('/parties') })
  }

  const doEnd = (): void => {
    if (!id) return
    end.mutate(id, { onSuccess: () => void sessionQuery.refetch() })
  }

  const doJoin = (): void => {
    if (!id) return
    join.mutate(
      { id, kind: 'viewer' },
      {
        onSuccess: () => {
          void sessionQuery.refetch()
          live.refresh()
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={session?.name || 'Party'}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={ended ? 'neutral' : 'good'}>{session?.status || 'unknown'}</Badge>
            {session?.inviteCode ? (
              <code className="font-mono text-xs tracking-wider text-ink-300">{formatInviteCode(session.inviteCode)}</code>
            ) : null}
            <span className="tabular-nums">
              {formatNumber(live.participants.filter((p) => !p.leftAt).length)}/{max} participants
            </span>
          </span>
        }
        actions={
          <>
            {shareUrl ? <CopyButton value={shareUrl} label="Copy share link" /> : null}
            {me ? (
              <button type="button" className="btn-secondary" onClick={doLeave} disabled={leave.isPending}>
                <LogOut className="h-4 w-4" aria-hidden />
                {leave.isPending ? 'Leaving…' : 'Leave'}
              </button>
            ) : null}
            {canEnd && !ended ? (
              <button type="button" className="btn-danger" onClick={doEnd} disabled={end.isPending}>
                <Square className="h-4 w-4" aria-hidden />
                {end.isPending ? 'Ending…' : 'End party'}
              </button>
            ) : null}
          </>
        }
      />

      {ended ? (
        <Banner tone="info">
          <Radio className="h-4 w-4" aria-hidden />
          This party has ended. Everything captured is shown below; nothing new will arrive.
        </Banner>
      ) : null}

      {live.needsJoin ? (
        <Banner tone="warn">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <span className="flex-1">
            You are not a participant, so the backend will not issue a realtime token. Stored keyframes are still shown.
          </span>
          <button type="button" className="btn-secondary text-xs" onClick={doJoin} disabled={join.isPending}>
            <LogIn className="h-3.5 w-3.5" aria-hidden />
            {join.isPending ? 'Joining…' : 'Join as viewer'}
          </button>
        </Banner>
      ) : null}

      {join.isError ? <Banner tone="bad">{errorMessage(join.error)}</Banner> : null}
      {leave.isError ? <Banner tone="bad">{errorMessage(leave.error)}</Banner> : null}
      {end.isError ? <Banner tone="bad">{errorMessage(end.error)}</Banner> : null}

      {live.realtimeUnavailable ? (
        <Banner tone="warn">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Realtime is not configured on this backend. The view is a snapshot of the stored keyframes.
        </Banner>
      ) : null}

      {live.error && !live.needsJoin && !live.realtimeUnavailable ? (
        <Banner tone="bad">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <span className="flex-1">{live.error}</span>
          <button type="button" className="btn-secondary text-xs" onClick={live.refresh}>
            Reconnect
          </button>
        </Banner>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2" aria-label="Live scene">
          <LiveStatsBar
            stats={live.stats}
            status={live.status}
            phase={live.phase}
            catchUp={live.catchUp}
            paused={paused}
            onTogglePause={() => setPaused((v) => !v)}
            onRecenter={() => setRecenterToken((n) => n + 1)}
            showTrajectories={showTrajectories}
            onToggleTrajectories={() => setShowTrajectories((v) => !v)}
            showFrustums={showFrustums}
            onToggleFrustums={() => setShowFrustums((v) => !v)}
            reconnects={live.reconnects}
          />
          <div className="relative h-[52vh] min-h-[300px] w-full bg-ink-950 lg:h-[62vh]">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-400">
                  <Spinner />
                  Loading the 3D viewer…
                </div>
              }
            >
              <PartyScene
                store={live.store}
                paused={paused}
                showTrajectories={showTrajectories}
                showFrustums={showFrustums}
                recenterToken={recenterToken}
              />
            </Suspense>
            {live.stats.points === 0 && live.catchUp.done ? (
              <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-ink-500">
                No points yet. Start capturing in this party from the phone app.
              </p>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <ParticipantsPanel
            participants={live.participants}
            presence={live.presence}
            stats={live.stats}
            maxParticipants={max}
            meId={me?.id ?? null}
          />

          <Card className="text-xs text-ink-400">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Reading the scene</p>
            <ul className="flex flex-col gap-1.5">
              <li>Each device draws its own cloud, tinted with its party colour over the captured RGB.</li>
              <li>The line is that device&apos;s path; the wireframe pyramid is where its camera is right now.</li>
              <li>
                Grey points are keyframes flagged <code className="font-mono">aligned: false</code> — captured before the
                phone saw the marker, so they are not in the party frame yet
                {unaligned > 0 ? ` (${formatNumber(unaligned)} so far)` : ''}.
              </li>
              {live.stats.droppedPoints > 0 ? (
                <li>
                  {formatNumber(live.stats.droppedPoints, true)} of the oldest points have been decimated to stay inside
                  the 2 M budget.
                </li>
              ) : null}
            </ul>
            <Link to="/parties" className="btn-ghost mt-3 px-0 text-xs">
              All parties
            </Link>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default PartyLivePage

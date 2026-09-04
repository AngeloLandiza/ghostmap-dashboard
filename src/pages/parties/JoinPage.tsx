/**
 * `/join/:code` — the share-link landing page (PLAN sections 2 and 4).
 *
 * The route sits behind `ProtectedRoute`, so an anonymous visitor is sent to `/login` with this
 * path as the return target and lands back here signed in. From here a browser always joins as a
 * `viewer`: mapping needs a device token, which only the phone app has.
 */
import { useParams, Link, useNavigate } from 'react-router-dom'
import { LogIn, Users } from 'lucide-react'
import { Badge, Card, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { errorMessage, isApiError } from '../../lib/api/client'
import { useJoinSession, useSessionByCode } from '../../lib/api/hooks'
import { formatInviteCode, formatNumber, formatRelative, normalizeInviteCode } from '../../lib/format'

/** `can_join: false` comes with a reason; a failed join comes back as an error code. */
function explain(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'session_full':
      return 'This party is full. Ask the owner to end it or raise the participant limit.'
    case 'session_ended':
      return 'This party has ended. Its map may already be merged.'
    case 'not_found':
      return 'No party has that invite code.'
    default:
      return reason ? `Cannot join: ${reason}` : null
  }
}

export function JoinPage(): JSX.Element {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const normalized = normalizeInviteCode(code)
  const { data, isPending, isError, error, refetch } = useSessionByCode(normalized, { enabled: normalized.length > 0 })
  const join = useJoinSession()

  if (normalized.length !== 8) {
    return (
      <div>
        <PageHeader title="Join a party" />
        <Card>
          <p className="text-sm text-ink-300">
            <span className="font-mono">{code}</span> is not a valid invite code. Codes are eight characters (A–Z and
            2–7).
          </p>
          <Link to="/parties" className="btn-secondary mt-3">
            Back to parties
          </Link>
        </Card>
      </div>
    )
  }

  if (isPending) return <LoadingState label="Looking up the party…" />
  if (isError) {
    return (
      <div>
        <PageHeader title="Join a party" description={`Invite code ${formatInviteCode(normalized)}`} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    )
  }

  const session = data?.session
  const canJoin = data?.canJoin ?? false
  const blocked = explain(data?.reason)
  const max = session?.maxParticipants || 4
  const joinError = join.error
  const joinBlocked = isApiError(joinError) ? explain(joinError.code) : null
  // `can_join` defaults to false while the backend is still growing this field, so only a
  // reason the contract defines actually disables the button.
  const hardBlock = data?.reason === 'session_full' || data?.reason === 'session_ended'

  const submit = (): void => {
    join.mutate(
      { code: normalized, kind: 'viewer' },
      {
        onSuccess: (res) => {
          const id = res.session.id
          if (id) navigate(`/parties/${id}`, { replace: true })
        },
      },
    )
  }

  return (
    <div>
      <PageHeader
        title={session?.name || 'Join a party'}
        description={`Invite code ${formatInviteCode(normalized)}`}
      />

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={session?.status === 'active' ? 'good' : 'neutral'}>{session?.status || 'unknown'}</Badge>
          <span className="inline-flex items-center gap-1 text-sm tabular-nums text-ink-300">
            <Users className="h-4 w-4" aria-hidden />
            {formatNumber(session?.participantCount ?? 0)}/{max} participants
          </span>
          {session?.ownerName ? <span className="text-sm text-ink-400">hosted by {session.ownerName}</span> : null}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-500">Origin</dt>
            <dd className="text-ink-200">
              {(session?.origin as { type?: string } | null)?.type === 'marker' ? 'Printed marker' : 'Session start'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-500">Keyframes</dt>
            <dd className="tabular-nums text-ink-200">{formatNumber(session?.keyframeCount ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-500">Created</dt>
            <dd className="text-ink-200">{formatRelative(session?.createdAt)}</dd>
          </div>
        </dl>

        {blocked && !canJoin ? <p className="text-sm text-amber-300">{blocked}</p> : null}
        {joinError ? <p className="text-sm text-red-400">{joinBlocked ?? errorMessage(joinError)}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={submit} disabled={join.isPending || hardBlock}>
            <LogIn className="h-4 w-4" aria-hidden />
            {join.isPending ? 'Joining…' : 'Join as viewer'}
          </button>
          {session?.id ? (
            <Link to={`/parties/${session.id}`} className="btn-ghost">
              Open without joining
            </Link>
          ) : null}
          <Link to="/parties" className="btn-ghost">
            All parties
          </Link>
        </div>

        <p className="text-[11px] leading-relaxed text-ink-500">
          Joining from a browser makes you a viewer: you see every device&apos;s points live but do not capture. Map
          from the phone app to join as a mapper.
        </p>
      </Card>
    </div>
  )
}

export default JoinPage

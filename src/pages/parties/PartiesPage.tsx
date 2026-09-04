/**
 * `/parties` — the party list, the create form and the join-with-code box (PLAN sections 2 and 4).
 *
 * A user token that creates a party does not become a participant (only a device creator does),
 * and a non-participant cannot get a realtime token, so creating is immediately followed by a
 * best-effort `POST /v1/sessions/:id/join` as a viewer. Rejoining is always allowed, so this is
 * safe even when the backend has already added the creator.
 */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import { InviteCodeChip } from '../../components/live/ShareLink'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api/client'
import { useCreateSession, useJoinSessionById, useSessions } from '../../lib/api/hooks'
import type { CreateSessionRequest, SessionRecord, SessionStatus } from '../../lib/api/types'
import { formatNumber, formatRelative, normalizeInviteCode } from '../../lib/format'

const MAX_PARTICIPANTS_LIMIT = 8

function statusTone(status: SessionStatus): 'good' | 'neutral' | 'info' | 'bad' {
  switch (status) {
    case 'active':
      return 'good'
    case 'merged':
      return 'info'
    case 'failed':
      return 'bad'
    default:
      return 'neutral'
  }
}

/* ---------------------------------------------------------------- create form */

function CreatePartyForm({ onCancel }: { onCancel: () => void }): JSX.Element {
  const navigate = useNavigate()
  const create = useCreateSession()
  const join = useJoinSessionById()
  const [name, setName] = useState('')
  const [originType, setOriginType] = useState<'session-start' | 'marker'>('session-start')
  const [markerId, setMarkerId] = useState('')
  const [maxParticipants, setMaxParticipants] = useState(4)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setError(null)
    const body: CreateSessionRequest = {
      name: name.trim() || 'Untitled party',
      origin:
        originType === 'marker'
          ? { type: 'marker', ...(markerId.trim() ? { marker_id: markerId.trim() } : {}) }
          : { type: 'session-start' },
      max_participants: Math.min(MAX_PARTICIPANTS_LIMIT, Math.max(1, Math.round(maxParticipants))),
    }
    create.mutate(body, {
      onSuccess: (res) => {
        const id = res.session.id
        if (!id) {
          setError('The backend created the party but did not return its id.')
          return
        }
        // Become a viewer so the live page can get an Ably token straight away.
        join.mutate(
          { id, kind: 'viewer' },
          {
            onSettled: () => navigate(`/parties/${id}`),
          },
        )
      },
      onError: (e) => setError(errorMessage(e)),
    })
  }

  const busy = create.isPending || join.isPending

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="party-name">
              Name
            </label>
            <input
              id="party-name"
              className="input"
              placeholder="Kitchen and hallway"
              value={name}
              maxLength={120}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="party-origin">
              Origin
            </label>
            <select
              id="party-origin"
              className="input"
              value={originType}
              onChange={(e) => setOriginType(e.target.value === 'marker' ? 'marker' : 'session-start')}
            >
              <option value="session-start">Session start (first device&apos;s pose)</option>
              <option value="marker">Printed marker</option>
            </select>
            <p className="mt-1.5 text-[11px] text-ink-500">
              {originType === 'marker'
                ? 'Every phone reports poses relative to the marker; keyframes captured before it is seen are greyed out.'
                : 'Poses are relative to where the first device started. Fine for a single mapper.'}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="party-max">
              Max participants
            </label>
            <input
              id="party-max"
              className="input"
              type="number"
              min={1}
              max={MAX_PARTICIPANTS_LIMIT}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(Number(e.target.value) || 4)}
            />
            <p className="mt-1.5 text-[11px] text-ink-500">
              Counts distinct accounts, not phones. Default 4, maximum {MAX_PARTICIPANTS_LIMIT}.
            </p>
          </div>

          {originType === 'marker' ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="party-marker">
                Marker id (optional)
              </label>
              <input
                id="party-marker"
                className="input font-mono"
                placeholder="ghostmap-marker"
                value={markerId}
                onChange={(e) => setMarkerId(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create party'}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

/* ------------------------------------------------------------------ join box */

function JoinWithCode(): JSX.Element {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const normalized = normalizeInviteCode(code)

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (normalized.length === 8) navigate(`/join/${normalized}`)
      }}
    >
      <div className="flex-1">
        <label className="label" htmlFor="join-code">
          Join with a code
        </label>
        <input
          id="join-code"
          className="input font-mono uppercase tracking-[0.25em]"
          placeholder="ABCD2EFG"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </div>
      <button type="submit" className="btn-secondary" disabled={normalized.length !== 8}>
        Look up
      </button>
    </form>
  )
}

/* ------------------------------------------------------------------- listing */

function PartyRow({ session }: { session: SessionRecord }): JSX.Element {
  const max = session.maxParticipants || 4
  return (
    <li className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/parties/${session.id}`} className="truncate text-sm font-medium text-white hover:text-ghost-300">
            {session.name || 'Untitled party'}
          </Link>
          <Badge tone={statusTone(session.status)}>{session.status}</Badge>
          {session.inviteCode ? <InviteCodeChip target={session} /> : null}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {formatNumber(session.participantCount)}/{max}
          </span>
          <span className="tabular-nums">{formatNumber(session.keyframeCount)} keyframes</span>
          {session.ownerName ? <span className="truncate">by {session.ownerName}</span> : null}
          <span>created {formatRelative(session.createdAt)}</span>
        </p>
      </div>
      <Link to={`/parties/${session.id}`} className="btn-secondary shrink-0 self-start text-xs sm:self-auto">
        {session.status === 'active' ? 'Watch live' : 'Open'}
      </Link>
    </li>
  )
}

const FILTERS: { label: string; value: SessionStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'active' },
  { label: 'Ended', value: 'ended' },
]

export function PartiesPage(): JSX.Element {
  const [filter, setFilter] = useState<SessionStatus | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const { data, isPending, isError, error, refetch } = useSessions(
    { limit: 50, ...(filter ? { status: filter } : {}) },
    { refetchInterval: 20_000 },
  )
  const sessions = data?.sessions ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Parties"
        description="Collaborative mapping sessions. Phones stream keyframes into a party; this dashboard watches them live."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden />
            New party
          </button>
        }
      />

      {creating ? <CreatePartyForm onCancel={() => setCreating(false)} /> : null}

      <Card>
        <JoinWithCode />
      </Card>

      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`btn px-2.5 py-1 text-xs ${
              filter === f.value ? 'border-ink-700 bg-ink-800 text-white' : 'text-ink-400 hover:bg-ink-850'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isPending ? <LoadingState label="Loading parties…" /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {!isPending && !isError && sessions.length === 0 ? (
        <EmptyState
          title="No parties yet"
          description="Create one here, or start a party from the phone app and it will show up as soon as it is created."
          action={
            <button type="button" className="btn-primary mt-2" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New party
            </button>
          }
        />
      ) : null}
      {sessions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <PartyRow key={session.id} session={session} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default PartiesPage

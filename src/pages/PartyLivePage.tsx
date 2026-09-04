/**
 * `/parties/:id` — the live party view (PLAN sections 2 and 4). This chunk owns both
 * three.js and the Ably SDK; keep those imports here.
 */
import { useParams } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader, PageStub } from '../components/ui'
import { useSession } from '../lib/api/hooks'
import { formatInviteCode } from '../lib/format'

export function PartyLivePage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const { data, isPending, isError, error, refetch } = useSession(id)

  if (isPending) return <LoadingState label="Loading party…" />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  const session = data?.session
  return (
    <div>
      <PageHeader
        title={session?.name || 'Party'}
        description={
          session
            ? `${session.status}${session.inviteCode ? ` · code ${formatInviteCode(session.inviteCode)}` : ''} · ${
                data?.participants.length ?? 0
              }/${session.maxParticipants} participants`
            : undefined
        }
      />
      <PageStub
        planRef="PLAN section 4 · live party view"
        todos={[
          'Participants panel: presence dots, colors, kind (device | viewer), display name, joined/left.',
          'Catch-up with useSessionKeyframes({ since_id }) then subscribe to `session:<id>` via Ably (rewind when available).',
          'One BufferGeometry per device, capacity grown in chunks, per-point RGB blended with the participant color, decimate past 2M points.',
          'Trajectories from keyframe poses and live frustums from `pose` messages; grey out keyframes with aligned:false.',
          'Copy share link, leave (useLeaveSession) and end (useEndSession, owner/leader/admin only).',
          'Ably credentials: pass api.realtime.token as the SDK authCallback so tokens renew.',
        ]}
      />
    </div>
  )
}

export default PartyLivePage

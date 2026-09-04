/**
 * `/join/:code` — the share-link landing page (PLAN section 4). `ProtectedRoute` has
 * already bounced anonymous visitors through /login and back here.
 */
import { useParams } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeader, PageStub } from '../components/ui'
import { useSessionByCode } from '../lib/api/hooks'
import { formatInviteCode, normalizeInviteCode } from '../lib/format'

export function JoinPage(): JSX.Element {
  const { code } = useParams<{ code: string }>()
  const normalized = normalizeInviteCode(code)
  const { data, isPending, isError, error, refetch } = useSessionByCode(normalized)

  if (isPending) return <LoadingState label="Looking up the party…" />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div>
      <PageHeader
        title={data?.session.name || 'Join a party'}
        description={`Invite code ${formatInviteCode(normalized)}`}
      />
      <PageStub
        planRef="PLAN section 4 · join by code"
        todos={[
          'Summary card: name, owner, status, participant_count / max_participants.',
          'Join as viewer with useJoinSession({ code, kind: "viewer" }), then navigate to /parties/:id.',
          'Explain can_join === false using reason: session_full (409) or session_ended (410).',
        ]}
      />
    </div>
  )
}

export default JoinPage

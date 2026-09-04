/**
 * `/parties` — party list, create and join-by-code (PLAN sections 2 and 4).
 */
import { ErrorState, LoadingState, PageHeader, PageStub } from '../components/ui'
import { useSessions } from '../lib/api/hooks'

export function PartiesPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useSessions({ limit: 50 })
  const sessions = data?.sessions ?? []

  return (
    <div>
      <PageHeader title="Parties" description="Collaborative mapping sessions, live and finished." />
      {isPending ? <LoadingState label="Loading parties…" /> : null}
      {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {!isPending && !isError ? (
        <PageStub
          planRef="PLAN section 4 · parties"
          todos={[
            'List with status, participant count / max, invite code and created time; link to /parties/:id.',
            'Create form (useCreateSession) with name, origin type (session-start | marker) and max_participants (default 4, max 8).',
            'Join-with-code box: normalizeInviteCode() then useJoinSession({ code, kind: "viewer" }).',
            'Copy share link (share_url or `${origin}/join/<code>`).',
          ]}
        >
          <p className="text-sm text-ink-400">
            {sessions.length} {sessions.length === 1 ? 'party' : 'parties'} visible to this account.
          </p>
        </PageStub>
      ) : null}
    </div>
  )
}

export default PartiesPage

/**
 * Ably connection for a party channel (PLAN section 2).
 *
 * The SDK is loaded with a dynamic `import()` so the ~100 KB realtime bundle only reaches
 * people who actually open a live party, and credentials come from `POST /v1/realtime/token`
 * through `authCallback`, which means tokens renew themselves for as long as the tab is open —
 * we never cache one ourselves.
 */
import type { ErrorInfo, Realtime, RealtimeChannel, TokenRequest } from 'ably'
import { api, errorMessage, isApiError } from '../api/client'
import type { RealtimeToken } from '../api/types'

/** Ably's connection states, collapsed to what the UI needs to say. */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'suspended'
  | 'failed'
  | 'closed'

export function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Live'
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return 'Reconnecting…'
    case 'suspended':
      return 'Connection lost'
    case 'failed':
      return 'Realtime failed'
    case 'closed':
      return 'Disconnected'
    default:
      return 'Idle'
  }
}

export function statusTone(status: ConnectionStatus): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'connected') return 'good'
  if (status === 'connecting' || status === 'reconnecting') return 'warn'
  if (status === 'failed' || status === 'suspended') return 'bad'
  return 'neutral'
}

function mapState(state: string): ConnectionStatus {
  switch (state) {
    case 'connected':
      return 'connected'
    case 'connecting':
      return 'connecting'
    case 'disconnected':
      return 'reconnecting'
    case 'suspended':
      return 'suspended'
    case 'failed':
      return 'failed'
    case 'closing':
    case 'closed':
      return 'closed'
    default:
      return 'idle'
  }
}

/** Why realtime is not available, when it is not. */
export type RealtimeBlock = 'forbidden' | 'not_configured' | 'error'

export class RealtimeUnavailableError extends Error {
  readonly reason: RealtimeBlock
  constructor(reason: RealtimeBlock, message: string) {
    super(message)
    this.name = 'RealtimeUnavailableError'
    this.reason = reason
  }
}

export interface SessionConnection {
  client: Realtime
  channel: RealtimeChannel
  /** Channel name the backend handed out (normally `session:<id>`). */
  channelName: string
  /** True when this principal may publish (a mapper device or a joined viewer). */
  canPublish: boolean
  close(): void
}

export interface OpenChannelOptions {
  sessionId: string
  /** Preferred channel name; the token response wins if it disagrees. */
  channelName?: string | null
  onStatus?: (status: ConnectionStatus, detail?: string) => void
}

/**
 * `POST /v1/realtime/token`, with the two "this is an answer, not a failure" statuses turned
 * into {@link RealtimeUnavailableError}.
 */
async function fetchToken(sessionId: string): Promise<RealtimeToken> {
  let res: RealtimeToken
  try {
    res = await api.realtime.token(sessionId)
  } catch (e) {
    if (isApiError(e) && e.isForbidden) {
      throw new RealtimeUnavailableError('forbidden', 'Join this party to watch it live.')
    }
    if (isApiError(e) && e.isNotConfigured) {
      throw new RealtimeUnavailableError('not_configured', 'Realtime is not configured on this backend.')
    }
    throw new RealtimeUnavailableError('error', errorMessage(e))
  }
  if (!res.tokenRequest) {
    throw new RealtimeUnavailableError('not_configured', 'The backend did not return Ably credentials.')
  }
  return res
}

/**
 * Opens the session channel. Rejects with a {@link RealtimeUnavailableError} when the backend
 * says this principal may not subscribe (403 — join the party first) or Ably is not configured
 * (501); both are states the page shows rather than errors it retries.
 */
export async function openSessionChannel(options: OpenChannelOptions): Promise<SessionConnection> {
  const { sessionId, onStatus } = options

  // One eager token so the 403/501 cases surface as a clear message instead of an Ably retry loop.
  const first = await fetchToken(sessionId)

  const channelName = first.channel || options.channelName || `session:${sessionId}`
  const Ably = await import('ably')

  let firstUse = true
  const client = new Ably.Realtime({
    // Ably calls this on connect and again whenever the token nears expiry.
    authCallback: (_params, callback: (err: ErrorInfo | string | null, token: TokenRequest | string | null) => void) => {
      if (firstUse) {
        firstUse = false
        callback(null, first.tokenRequest as TokenRequest)
        return
      }
      api.realtime
        .token(sessionId)
        .then((res) => {
          if (!res.tokenRequest) callback('The backend did not return Ably credentials.', null)
          else callback(null, res.tokenRequest as TokenRequest)
        })
        .catch((e: unknown) => callback(errorMessage(e), null))
    },
    // We render our own points from the REST catch-up; echoing our own publishes back is noise.
    echoMessages: false,
    closeOnUnload: true,
  })

  if (onStatus) {
    onStatus(mapState(client.connection.state))
    client.connection.on((change) => {
      onStatus(mapState(change.current), change.reason?.message)
    })
  }

  const channel = client.channels.get(channelName)

  return {
    client,
    channel,
    channelName,
    canPublish: first.canPublish,
    close(): void {
      try {
        channel.unsubscribe()
        channel.presence.unsubscribe()
        client.close()
      } catch {
        /* already closed */
      }
    },
  }
}

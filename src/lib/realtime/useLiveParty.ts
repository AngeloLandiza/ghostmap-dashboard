/**
 * The live-party data pump (PLAN sections 2 and 4): REST catch-up, an Ably subscription,
 * presence, and a {@link LiveStore} the 3D scene reads directly.
 *
 * Ordering matters. We subscribe *before* the catch-up loop and buffer everything that arrives
 * while it runs, then flush the buffer through the same deduplicating ingest path. That closes
 * the window between "last row the REST query saw" and "first message the socket delivered"
 * without relying on channel rewind, and it makes a reconnect cheap: re-run the catch-up from
 * the highest keyframe id we already hold and let `(device_id, seq)` drop the overlap.
 *
 * React state is updated on a timer, never per message — at 3 keyframes/s/device with a pose
 * stream at 10 Hz, re-rendering per message would cost more than drawing the points.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Message, PresenceMessage } from 'ably'
import { api, errorMessage } from '../api/client'
import {
  keyframesMessageSchema,
  mergeMessageSchema,
  participantMessageSchema,
  poseMessageSchema,
  presenceDataSchema,
  sessionMessageSchema,
  type SessionParticipant,
} from '../api/types'
import {
  RealtimeUnavailableError,
  openSessionChannel,
  type ConnectionStatus,
  type RealtimeBlock,
  type SessionConnection,
} from './ably'
import { LiveStore, emptyStats, type LiveStats } from './liveStore'

/** Keyframes per catch-up page (PLAN section 4). */
const CATCH_UP_PAGE = 500
/** Hard stop on the catch-up loop: 200 pages is 100 000 keyframes. */
const MAX_CATCH_UP_PAGES = 200
/** Ceiling on messages buffered while a catch-up runs; a stalled query must not eat memory. */
const MAX_BUFFERED_MESSAGES = 5000
/** How often the counters and participant panel re-render. */
const STATS_INTERVAL_MS = 300

export interface PresenceEntry {
  clientId: string
  userId: string | null
  displayName: string
  kind: string
  color: string
}

export type LivePhase = 'idle' | 'catching-up' | 'live' | 'offline'

export interface UseLivePartyOptions {
  sessionId: string | undefined
  /** Participants from `GET /v1/sessions/:id`; their colours tint each device's points. */
  participants: readonly SessionParticipant[]
  /** Channel name from the session response, if the backend already told us one. */
  channelName?: string | null
  /** Our own participant row, used for the presence payload. */
  me?: SessionParticipant | null
  enabled?: boolean
}

export interface UseLivePartyResult {
  store: LiveStore
  stats: LiveStats
  status: ConnectionStatus
  phase: LivePhase
  /** Message for the banner when realtime could not be opened at all. */
  error: string | null
  /** Set when the backend refused a realtime token: this account has not joined the party. */
  needsJoin: boolean
  /** Set when the backend has no Ably configuration; catch-up still works. */
  realtimeUnavailable: boolean
  catchUp: { loaded: number; done: boolean }
  presence: PresenceEntry[]
  /** Participants, kept current by `participant` messages. */
  participants: SessionParticipant[]
  /** True once a `session` message announced the party ended. */
  ended: boolean
  reconnects: number
  /** Re-runs the whole connect + catch-up cycle (the "Reconnect" button). */
  refresh(): void
}

export function useLiveParty(options: UseLivePartyOptions): UseLivePartyResult {
  const { sessionId, participants, channelName, me, enabled = true } = options

  const storeRef = useRef<LiveStore | null>(null)
  if (!storeRef.current) storeRef.current = new LiveStore()
  const store = storeRef.current

  const [stats, setStats] = useState<LiveStats>(emptyStats)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [phase, setPhase] = useState<LivePhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [block, setBlock] = useState<RealtimeBlock | null>(null)
  const [catchUp, setCatchUp] = useState<{ loaded: number; done: boolean }>({ loaded: 0, done: false })
  const [presence, setPresence] = useState<PresenceEntry[]>([])
  const [liveParticipants, setLiveParticipants] = useState<SessionParticipant[]>(() => [...participants])
  const [ended, setEnded] = useState(false)
  const [reconnects, setReconnects] = useState(0)
  const [nonce, setNonce] = useState(0)

  /** Stable identity for the participant list, so effects do not loop on a fresh array. */
  const participantsKey = useMemo(
    () => participants.map((p) => `${p.id}|${p.deviceId ?? ''}|${p.color}|${p.displayName}|${p.leftAt ?? ''}`).join('~'),
    [participants],
  )

  // Adopt the server's list whenever it actually changes; realtime events patch it from there.
  useEffect(() => {
    setLiveParticipants([...participants])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- participantsKey is the value identity
  }, [participantsKey])

  // Colours are per participant, so a device's points get the right tint from its first keyframe.
  useEffect(() => {
    const byDevice = new Map<string, string>()
    for (const p of liveParticipants) {
      if (p.deviceId && p.color) byDevice.set(p.deviceId, p.color)
    }
    store.setColorResolver((deviceId) => byDevice.get(deviceId) ?? '')
  }, [liveParticipants, store])

  // Reset everything when the party changes; otherwise one party's points would leak into another.
  useEffect(() => {
    store.reset()
    setStats(emptyStats())
    setCatchUp({ loaded: 0, done: false })
    setPresence([])
    setEnded(false)
    setReconnects(0)
  }, [sessionId, store])

  const meKey = me ? `${me.id}|${me.displayName}|${me.color}|${me.kind}|${me.userId ?? ''}` : ''

  useEffect(() => {
    if (!sessionId || !enabled) {
      setPhase('idle')
      return
    }

    let cancelled = false
    let connection: SessionConnection | null = null
    let catchUpDone = false
    let catchUpRunning = false
    let sawConnected = false
    let loaded = 0
    const pending: Array<{ name: string; data: unknown }> = []
    const abort = new AbortController()

    const applyKeyframes = (data: unknown): void => {
      const parsed = keyframesMessageSchema.safeParse(data)
      if (!parsed.success) return
      store.ingestKeyframes(parsed.data.keyframes, {
        deviceId: parsed.data.deviceId,
        color: parsed.data.color,
      })
    }

    const applyParticipant = (data: unknown): void => {
      const parsed = participantMessageSchema.safeParse(data)
      if (!parsed.success || !parsed.data.participant) return
      const incoming = parsed.data.participant
      const left = parsed.data.event === 'left'
      setLiveParticipants((current) => {
        const at = current.findIndex(
          (p) => (incoming.id && p.id === incoming.id) || (incoming.deviceId && p.deviceId === incoming.deviceId),
        )
        const row: SessionParticipant = left ? { ...incoming, leftAt: incoming.leftAt ?? new Date().toISOString() } : { ...incoming, leftAt: null }
        if (at < 0) return [...current, row]
        const next = [...current]
        next[at] = { ...current[at], ...row } as SessionParticipant
        return next
      })
    }

    const apply = (name: string, data: unknown): void => {
      switch (name) {
        case 'keyframes':
          applyKeyframes(data)
          break
        case 'pose': {
          const parsed = poseMessageSchema.safeParse(data)
          if (parsed.success) store.ingestPose(parsed.data)
          break
        }
        case 'participant':
          applyParticipant(data)
          break
        case 'session': {
          const parsed = sessionMessageSchema.safeParse(data)
          if (parsed.success && parsed.data.event === 'ended') setEnded(true)
          break
        }
        case 'merge': {
          // Nothing to draw, but a failed merge should not look like a dropped message.
          mergeMessageSchema.safeParse(data)
          break
        }
        default:
          break
      }
    }

    const onMessage = (msg: Message): void => {
      store.noteMessage()
      const name = msg.name ?? ''
      if (!catchUpDone) {
        // Oldest first: anything this deep in the buffer is almost certainly a row the
        // catch-up query is fetching anyway.
        if (pending.length >= MAX_BUFFERED_MESSAGES) pending.shift()
        pending.push({ name, data: msg.data })
        return
      }
      apply(name, msg.data)
    }

    const refreshPresence = (): void => {
      const channel = connection?.channel
      if (!channel) return
      channel.presence
        .get()
        .then((members: PresenceMessage[]) => {
          if (cancelled) return
          setPresence(
            members.map((m) => {
              const parsed = presenceDataSchema.safeParse(m.data)
              const data = parsed.success ? parsed.data : null
              return {
                clientId: m.clientId ?? '',
                userId: data?.userId ?? null,
                displayName: data?.displayName || m.clientId || 'Someone',
                kind: data?.kind || 'viewer',
                color: data?.color || '',
              }
            }),
          )
        })
        .catch(() => {
          /* presence is best-effort; the panel falls back to the participant rows */
        })
    }

    /** Pages `GET /v1/sessions/:id/keyframes` from `since` until the backend runs out. */
    const runCatchUp = async (since: number): Promise<void> => {
      if (catchUpRunning) return
      catchUpRunning = true
      try {
        let cursor = since
        for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
          if (cancelled) return
          const res = await api.sessions.keyframes(
            sessionId,
            { since_id: cursor, limit: CATCH_UP_PAGE },
            abort.signal,
          )
          const rows = res.keyframes ?? []
          if (rows.length === 0) break
          store.ingestKeyframes(rows)
          loaded += rows.length
          if (!cancelled) setCatchUp({ loaded, done: false })
          const highest = rows.reduce((max, row) => (row.id > max ? row.id : max), cursor)
          const next = res.nextSinceId > cursor ? res.nextSinceId : highest
          if (next <= cursor) break
          cursor = next
          if (rows.length < CATCH_UP_PAGE) break
        }
      } finally {
        catchUpRunning = false
      }
    }

    /**
     * Runs a catch-up with live messages buffered, then flushes them.
     *
     * The buffering is what makes a reconnect safe: `(device_id, seq)` deduplication drops
     * anything with a sequence number at or below the highest already seen, so a live message
     * applied *before* the rows it follows would make the catch-up's own rows look stale and
     * punch a hole in the cloud.
     */
    const resync = async (from: number): Promise<void> => {
      if (catchUpRunning) return
      catchUpDone = false
      try {
        await runCatchUp(from)
      } catch (e) {
        if (!cancelled && !(e instanceof DOMException && e.name === 'AbortError')) {
          setError((current) => current ?? errorMessage(e))
        }
      } finally {
        catchUpDone = true
        const buffered = pending.splice(0)
        if (!cancelled) for (const msg of buffered) apply(msg.name, msg.data)
      }
    }

    const start = async (): Promise<void> => {
      setError(null)
      setBlock(null)
      setPhase('catching-up')

      // 1. Subscribe first and buffer, so nothing published during catch-up is lost.
      try {
        connection = await openSessionChannel({
          sessionId,
          channelName: channelName ?? null,
          onStatus: (next) => {
            if (cancelled) return
            setStatus(next)
            if (next === 'connected') {
              if (sawConnected) {
                // Came back from a drop: refill the gap and re-read presence.
                setReconnects((n) => n + 1)
                void resync(store.lastKeyframeId)
                refreshPresence()
              }
              sawConnected = true
            }
          },
        })
        if (cancelled) {
          connection.close()
          return
        }
        void connection.channel.subscribe(onMessage)
        void connection.channel.presence.subscribe(refreshPresence)
        const identity = me
          ? { user_id: me.userId, display_name: me.displayName, kind: me.kind, color: me.color }
          : { kind: 'viewer' as const }
        connection.channel.presence.enter(identity).catch(() => {
          /* a subscribe-only token cannot enter presence; watching still works */
        })
        refreshPresence()
      } catch (e) {
        if (cancelled) return
        if (e instanceof RealtimeUnavailableError) {
          setBlock(e.reason)
          setError(e.message)
        } else {
          setBlock('error')
          setError(errorMessage(e))
        }
        setStatus('idle')
      }

      // 2. Catch up on everything already stored, then release the buffered messages.
      await resync(0)
      if (cancelled) return
      setCatchUp({ loaded, done: true })
      setPhase(connection ? 'live' : 'offline')
    }

    void start()

    return () => {
      cancelled = true
      abort.abort()
      connection?.close()
      connection = null
    }
    // `meKey` and `participantsKey` are value identities for `me` / colour assignment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, enabled, channelName, meKey, nonce, store])

  // Counters and ages, sampled rather than pushed.
  useEffect(() => {
    if (!sessionId || !enabled) return
    const id = window.setInterval(() => setStats(store.stats()), STATS_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [sessionId, enabled, store])

  const refresh = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  return {
    store,
    stats,
    status,
    phase,
    error,
    needsJoin: block === 'forbidden',
    realtimeUnavailable: block === 'not_configured',
    catchUp,
    presence,
    participants: liveParticipants,
    ended,
    reconnects,
    refresh,
  }
}

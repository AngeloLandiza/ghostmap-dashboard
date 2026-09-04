/**
 * Toolbar above the live scene: connection state, the counters PLAN section 4 asks for
 * (keyframes, points, messages/s) and the viewer controls.
 */
import { Crosshair, Pause, Play, Route, Video } from 'lucide-react'
import { statusLabel, statusTone, type ConnectionStatus } from '../../lib/realtime/ably'
import { MAX_POINTS, type LiveStats } from '../../lib/realtime/liveStore'
import type { LivePhase } from '../../lib/realtime/useLiveParty'
import { formatNumber } from '../../lib/format'
import { Badge, Spinner } from '../ui'

function Counter({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: string
  hint?: string
  /** E2E hook (`e2e/`): identifies this counter regardless of its label text. */
  testId?: string
}): JSX.Element {
  return (
    <div data-testid={testId ? `stat-${testId}` : undefined}>
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-ink-100" title={hint}>
        {value}
      </p>
    </div>
  )
}

function Toggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Route
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`btn px-2 py-1.5 text-xs ${active ? 'border-ink-700 bg-ink-800 text-white' : 'text-ink-400 hover:bg-ink-850'}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export interface LiveStatsBarProps {
  stats: LiveStats
  status: ConnectionStatus
  phase: LivePhase
  catchUp: { loaded: number; done: boolean }
  paused: boolean
  onTogglePause: () => void
  onRecenter: () => void
  showTrajectories: boolean
  onToggleTrajectories: () => void
  showFrustums: boolean
  onToggleFrustums: () => void
  reconnects: number
}

export function LiveStatsBar({
  stats,
  status,
  phase,
  catchUp,
  paused,
  onTogglePause,
  onRecenter,
  showTrajectories,
  onToggleTrajectories,
  showFrustums,
  onToggleFrustums,
  reconnects,
}: LiveStatsBarProps): JSX.Element {
  const budgetPct = Math.min(100, Math.round((stats.points / MAX_POINTS) * 100))
  return (
    // Stacks into three compact rows on a phone and collapses to one on a tablet upwards.
    <div className="flex flex-col gap-2 border-b border-ink-800 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
      <div className="flex items-center gap-2">
        <Badge tone={statusTone(status)}>
          {status === 'connecting' || status === 'reconnecting' ? <Spinner className="h-3 w-3" /> : null}
          {statusLabel(status)}
        </Badge>
        {phase === 'catching-up' ? (
          <span className="flex items-center gap-1.5 text-xs text-ink-400">
            <Spinner className="h-3 w-3" />
            catching up · {formatNumber(catchUp.loaded)}
          </span>
        ) : null}
        {reconnects > 0 ? (
          <span className="text-[11px] text-ink-500" title="Times the socket dropped and refilled the gap">
            {reconnects} reconnect{reconnects === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:flex-1">
        <Counter label="Keyframes" value={formatNumber(stats.keyframes)} testId="keyframes" />
        <Counter
          label="Points"
          value={formatNumber(stats.points, true)}
          hint={`${formatNumber(stats.points)} of a ${formatNumber(MAX_POINTS, true)} budget (${budgetPct}%)${
            stats.droppedPoints ? ` · ${formatNumber(stats.droppedPoints, true)} decimated` : ''
          }`}
          testId="points"
        />
        <Counter label="Msg/s" value={stats.messagesPerSecond.toFixed(1)} testId="msgs" />
        <Counter label="Devices" value={formatNumber(stats.devices.length)} testId="devices" />
      </div>

      <div className="flex items-center gap-1.5">
        <Toggle active={showTrajectories} onClick={onToggleTrajectories} icon={Route} label="Paths" />
        <Toggle active={showFrustums} onClick={onToggleFrustums} icon={Video} label="Cameras" />
        <button type="button" className="btn-secondary px-2 py-1.5 text-xs" onClick={onRecenter} title="Recenter the camera">
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Recenter</span>
        </button>
        <button
          type="button"
          className="btn-secondary px-2 py-1.5 text-xs"
          onClick={onTogglePause}
          title={paused ? 'Resume rendering' : 'Pause rendering (data keeps arriving)'}
        >
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
          <span className="hidden sm:inline">{paused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>
    </div>
  )
}

export default LiveStatsBar

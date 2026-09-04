/**
 * Dark-theme defaults for the recharts charts on the admin pages.
 *
 * recharts is only imported from files under `src/components/admin/**` and the admin route
 * chunks, so it stays out of the entry bundle (see the `charts` manual chunk in
 * vite.config.ts) and is downloaded only when an admin opens one of these pages.
 */
import type { ReactElement } from 'react'
import { ResponsiveContainer } from 'recharts'
import { formatBytes, formatNumber, formatUsd } from '../../lib/format'

/** Categorical palette: readable on `bg-ink-950`, distinct at small sizes. */
export const CHART_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#facc15',
  '#c084fc',
  '#fb923c',
  '#2dd4bf',
  '#f87171',
  '#a3e635',
  '#60a5fa',
  '#e879f9',
  '#fbbf24',
] as const

/** Stable color for a series name, so a provider keeps its color across charts. */
export function colorForSeries(name: string, index?: number): string {
  if (typeof index === 'number' && index >= 0) return CHART_COLORS[index % CHART_COLORS.length] as string
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return CHART_COLORS[hash % CHART_COLORS.length] as string
}

export const AXIS_PROPS = {
  stroke: '#6b8199',
  tickLine: false,
  axisLine: false,
  tick: { fill: '#95a8bd', fontSize: 11 },
} as const

export const GRID_PROPS = {
  stroke: '#1f2c3c',
  strokeDasharray: '3 3',
  vertical: false,
} as const

export const TOOLTIP_PROPS = {
  contentStyle: {
    background: '#101823',
    border: '1px solid #2c3d52',
    borderRadius: 10,
    fontSize: 12,
    color: '#c2cede',
    boxShadow: '0 8px 24px -12px rgba(0,0,0,.8)',
  },
  labelStyle: { color: '#95a8bd', marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { fill: 'rgba(56,189,248,.08)' },
} as const

/**
 * Series defaults. The mount animation is off on purpose: `ResponsiveContainer` re-measures
 * whenever the pane is resized or re-shown, which restarts the animation and leaves the
 * chart looking empty for a moment — and it makes screenshots and Playwright assertions
 * non-deterministic. Charts here are read, not performed.
 */
export const SERIES_PROPS = { isAnimationActive: false } as const

export const LEGEND_PROPS = {
  wrapperStyle: { fontSize: 11, color: '#95a8bd', paddingTop: 8 },
  iconSize: 8,
} as const

/* ------------------------------------------------------------------ formatters */

export const usdTick = (value: number): string => formatUsd(value)
export const numberTick = (value: number): string => formatNumber(value, true)
export const bytesTick = (value: number): string => formatBytes(value, 0)

/** `2026-09-04` -> `Sep 4`; anything unparseable is returned unchanged. */
export function shortDay(day: string): string {
  const ms = Date.parse(day)
  if (!Number.isFinite(ms)) return day
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** `2026-09-04T13:00:00Z` -> `13:00`. */
export function shortHour(hour: string): string {
  const ms = Date.parse(hour)
  if (!Number.isFinite(ms)) return hour
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/* ----------------------------------------------------------------------- frame */

/**
 * Fixed-height responsive wrapper. A height in pixels (rather than a percentage) keeps
 * `ResponsiveContainer` from collapsing inside the flex column layout of the pages.
 */
export function ChartFrame({
  height = 260,
  children,
  className = '',
}: {
  height?: number
  children: ReactElement
  className?: string
}): JSX.Element {
  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

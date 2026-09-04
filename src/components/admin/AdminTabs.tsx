/** Sub-navigation shared by the four `/admin*` routes (PLAN section 4). */
import { NavLink } from 'react-router-dom'
import { Activity, Coins, HardDrive, LayoutDashboard } from 'lucide-react'

const TABS = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/costs', label: 'Costs', icon: Coins, end: false },
  { to: '/admin/network', label: 'Network', icon: Activity, end: false },
  { to: '/admin/storage', label: 'Storage', icon: HardDrive, end: false },
] as const

export function AdminTabs(): JSX.Element {
  return (
    <nav aria-label="Admin sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            [
              'flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
              isActive
                ? 'border-ghost-700/70 bg-ghost-700/20 text-ghost-300'
                : 'border-ink-700/70 bg-ink-900/60 text-ink-300 hover:bg-ink-850 hover:text-white',
            ].join(' ')
          }
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default AdminTabs

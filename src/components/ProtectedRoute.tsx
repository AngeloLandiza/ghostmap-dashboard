/**
 * Route guard. Unauthenticated visitors are sent to /login with the location they wanted,
 * so signing in returns them there (this is what makes a shared /join/:code link work).
 * `requireAdmin` additionally waits for the `GET /admin/overview` probe in `useAuth()`.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { EmptyState, LoadingState } from './ui'

export interface ProtectedRouteProps {
  requireAdmin?: boolean
  children?: ReactNode
}

export function ProtectedRoute({ requireAdmin = false, children }: ProtectedRouteProps): JSX.Element {
  const { isAuthenticated, isAdmin, adminChecked } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (requireAdmin) {
    if (!adminChecked) return <LoadingState label="Checking admin access…" />
    if (!isAdmin) {
      return (
        <EmptyState
          title="Admin only"
          description="This area needs the admin key. Sign in again with ADMIN_API_KEY to see health, network, storage and costs."
        />
      )
    }
  }

  return <>{children ?? <Outlet />}</>
}

export default ProtectedRoute

/**
 * Routing (PLAN section 4). Every page is a lazy chunk, so the heavy dependencies — three.js
 * in the map and party viewers, recharts in the admin console — are only downloaded by the
 * people who open those routes.
 */
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import ProtectedRoute from './components/ProtectedRoute'
import { LoadingState } from './components/ui'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const MapsPage = lazy(() => import('./pages/MapsPage'))
const MapDetailPage = lazy(() => import('./pages/MapDetailPage'))
const PartiesPage = lazy(() => import('./pages/PartiesPage'))
const PartyLivePage = lazy(() => import('./pages/PartyLivePage'))
const JoinPage = lazy(() => import('./pages/JoinPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const AdminPage = lazy(() => import('./pages/admin/AdminPage'))
const AdminCostsPage = lazy(() => import('./pages/admin/AdminCostsPage'))
const AdminNetworkPage = lazy(() => import('./pages/admin/AdminNetworkPage'))
const AdminStoragePage = lazy(() => import('./pages/admin/AdminStoragePage'))

export function App(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        {/* Sign-in stands outside the app chrome. */}
        <Route path="/login" element={<LoginPage />} />

        <Route element={<AppLayout />}>
          {/* Reachable while signed out: a wrong API base must stay fixable. */}
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<ProtectedRoute />}>
            <Route index element={<MapsPage />} />
            <Route path="/maps/:id" element={<MapDetailPage />} />
            <Route path="/parties" element={<PartiesPage />} />
            <Route path="/parties/:id" element={<PartyLivePage />} />
            <Route path="/join/:code" element={<JoinPage />} />

            <Route element={<ProtectedRoute requireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/costs" element={<AdminCostsPage />} />
              <Route path="/admin/network" element={<AdminNetworkPage />} />
              <Route path="/admin/storage" element={<AdminStoragePage />} />
            </Route>
          </Route>

          <Route path="/maps" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App

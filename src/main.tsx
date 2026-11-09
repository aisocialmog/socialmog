import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './styles/index.css'
import { PrefsProvider } from './lib/prefs'
import { AuthProvider, useAuth } from './lib/auth'
import { canOpen, NAV } from './lib/access'
import { AppShell } from './layout/AppShell'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { BrandsPage } from './pages/brands/BrandsPage'
import { BrandDetail } from './pages/brands/BrandDetail'
import { BrandForm } from './pages/brands/BrandForm'
import { CreatorsPage } from './pages/creators/CreatorsPage'
import { CreatorDetail } from './pages/creators/CreatorDetail'
import { CreatorForm } from './pages/creators/CreatorForm'
import { CreatorImport } from './pages/creators/CreatorImport'
import { ShortlistDetail, ShortlistsPage } from './pages/creators/Shortlists'
import { NotAllowed, Placeholder } from './pages/Placeholder'
import { Login } from './pages/auth/Login'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import { AuthCallback } from './pages/auth/AuthCallback'
import { NoAccess } from './pages/auth/NoAccess'
import { EnsoSpinner } from './components/art/Ink'
import { EmptyState } from './components/ui/kit'

function Loading() {
  return <div className="min-h-screen grid place-items-center"><EnsoSpinner size={48} label="Loading Social Mog OS" /></div>
}

/** Everything behind login. Pages a role can't open show NotAllowed
 *  (and the database returns nothing for them anyway). */
function Protected() {
  const { state, role } = useAuth()
  const loc = useLocation()
  if (state.kind === 'loading') return <Loading />
  if (state.kind === 'signed_out') return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (state.kind === 'no_access') return <NoAccess email={state.email} reason={state.reason} />
  const allowed = canOpen(role!, loc.pathname)
  return (
    <AppShell>
      {!allowed ? <NotAllowed /> : (
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/brands" element={<BrandsPage />} />
          <Route path="/brands/new" element={<BrandForm />} />
          <Route path="/brands/:id" element={<BrandDetail />} />
          <Route path="/brands/:id/edit" element={<BrandForm />} />
          <Route path="/creators" element={<CreatorsPage />} />
          <Route path="/creators/new" element={<CreatorForm />} />
          <Route path="/creators/import" element={<CreatorImport />} />
          <Route path="/creators/shortlists" element={<ShortlistsPage />} />
          <Route path="/creators/shortlists/:id" element={<ShortlistDetail />} />
          <Route path="/creators/:id" element={<CreatorDetail />} />
          <Route path="/creators/:id/edit" element={<CreatorForm />} />
          {NAV.filter(n => !['/', '/settings', '/brands', '/creators'].includes(n.to)).map(n => (
            <Route key={n.to} path={`${n.to}/*`} element={<Placeholder title={n.label} kanji={n.kanji} feature={n.feature} />} />
          ))}
          <Route path="*" element={<div className="shoji"><EmptyState line="A path through the mist that leads nowhere." /></div>} />
        </Routes>
      )}
    </AppShell>
  )
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()
  if (state.kind === 'loading') return <Loading />
  if (state.kind === 'ready') return <Navigate to="/" replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrefsProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/*" element={<Protected />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </PrefsProvider>
  </React.StrictMode>,
)

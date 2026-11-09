import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom'
import './styles/index.css'
import { PrefsProvider } from './lib/prefs'
import { AppShell } from './layout/AppShell'
import { Dashboard } from './pages/Dashboard'
import { BrandsList } from './pages/BrandsList'
import { BrandDetail } from './pages/BrandDetail'
import { Login } from './pages/Login'
import { Placeholder } from './pages/Placeholder'
import { NAV } from './layout/nav'
import { EmptyState } from './components/ui/kit'

const FEATURE: Record<string, number> = {
  '/creators': 3, '/campaigns': 4, '/production': 5, '/calendar': 5, '/tasks': 8,
  '/money': 6, '/reports': 9, '/ai': 10, '/settings': 13,
}

function BrandRoute() {
  const { id } = useParams()
  return id === 'b1' ? <BrandDetail /> : <div className="shoji"><EmptyState sketch="koi" line="This page in the preview only has the Mama Bites detail." /></div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrefsProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={
            <AppShell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/brands" element={<BrandsList />} />
                <Route path="/brands/:id" element={<BrandRoute />} />
                {NAV.filter(n => FEATURE[n.to]).map(n => (
                  <Route key={n.to} path={n.to} element={<Placeholder title={n.label} kanji={n.kanji} feature={FEATURE[n.to]} />} />
                ))}
                <Route path="*" element={<div className="shoji"><EmptyState line="A path through the mist that leads nowhere." /></div>} />
              </Routes>
            </AppShell>
          } />
        </Routes>
      </BrowserRouter>
    </PrefsProvider>
  </React.StrictMode>,
)

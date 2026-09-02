import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api.ts'
import { ChangeView } from './components/ChangeView.tsx'
import { DeskHome } from './components/DeskHome.tsx'
import { IssueView } from './components/IssueView.tsx'
import { ManualView } from './components/ManualView.tsx'
import { SectionEditor } from './components/SectionEditor.tsx'
import { StatusLamp } from './components/StatusLamp.tsx'
import type { DeskPayload } from './types.ts'

export default function App() {
  const location = useLocation()
  const [desk, setDesk] = useState<DeskPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setDesk(await api.desk())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read the control library.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [location.pathname])

  const openChanges = (desk?.changes ?? []).filter(
    (change) => change.status !== 'launched' && change.status !== 'withdrawn',
  )

  return (
    <div className="desk">
      <header className="mast">
        <div className="mast-brand">
          <Link className="wordmark" to="/">
            REVDESK
          </Link>
          <div className="mast-title">Controlled Manual Desk</div>
        </div>
        <div className="mast-meta">LOCAL LIBRARY · NO AUTH · FILE-BACKED</div>
      </header>

      <aside className="rail">
        <nav className="rail-block">
          <h2>Manuals</h2>
          {(desk?.manuals ?? []).map((manual) => (
            <NavLink key={manual.id} to={`/manuals/${manual.id}`} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`}>
              <span className="id">{manual.abbrev}</span>
              <span className="name">{manual.title}</span>
              <span className="rev">{manual.current_issued ?? `R${manual.next_revision}?`}</span>
            </NavLink>
          ))}
        </nav>
        <nav className="rail-block">
          <h2>Open changes</h2>
          {openChanges.length === 0 ? <div className="empty">None on the desk.</div> : null}
          {openChanges.map((change) => (
            <NavLink key={change.id} to={`/changes/${change.id}`} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`}>
              <span className="id">{change.id}</span>
              <span className="name">{change.title}</span>
              <StatusLamp status={change.status} />
            </NavLink>
          ))}
        </nav>
        <nav className="rail-block">
          <h2>Issued</h2>
          {(desk?.issues ?? []).map((issue) => (
            <NavLink key={issue.id} to={`/issues/${issue.id}`} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`}>
              <span className="id">{issue.id}</span>
              <span className="name">{issue.summary}</span>
              <span className="rev">{issue.revision}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="stage">
        {error ? <div className="banner error">{error}</div> : null}
        <Routes>
          <Route path="/" element={<DeskHome desk={desk} />} />
          <Route path="/manuals/:manualId" element={<ManualView onChanged={refresh} />} />
          <Route path="/changes/:changeId" element={<ChangeView onChanged={refresh} />} />
          <Route path="/changes/:changeId/sections/:sectionId" element={<SectionEditor onChanged={refresh} />} />
          <Route path="/issues/:issueId" element={<IssueView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

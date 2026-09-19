import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

// Split per route: the phone bundle stays tiny (no three.js / rapier), the host loads the 3D stack.
const HostPage = lazy(() => import('./host/HostPage'))
const JoinPage = lazy(() => import('./phone/JoinPage'))

function Loading() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--neon-cyan)',
        letterSpacing: '0.4em',
        fontWeight: 900,
      }}
    >
      BEAT CODEX
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/host" replace />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={<Navigate to="/host" replace />} />
      </Routes>
    </Suspense>
  )
}

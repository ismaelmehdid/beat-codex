import { Navigate, Route, Routes } from 'react-router-dom'
import HostPage from './host/HostPage'
import JoinPage from './phone/JoinPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/host" replace />} />
      <Route path="/host" element={<HostPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="*" element={<Navigate to="/host" replace />} />
    </Routes>
  )
}

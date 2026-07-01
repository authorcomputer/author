import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import Home from './pages/Home'
import Editor from './pages/Editor'
import Public from './pages/Public'
import Landing from './pages/Landing'
import Profile from './pages/Profile'
import UserPublic from './pages/UserPublic'
import { token } from './api'

function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation()
  if (!token()) {
    const dest = location.pathname + location.search + location.hash
    return <Navigate to={`/login?next=${encodeURIComponent(dest)}`} replace />
  }
  return children
}

// Rendered fresh on every navigation to "/", so the auth check isn't frozen
// at App mount (route `element`s are created once per App render).
function RootGate() {
  useLocation()
  return token() ? <Home /> : <Landing />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/p/:slug" element={<Public />} />
        <Route path="/u/:username" element={<UserPublic />} />
        <Route path="/" element={<RootGate />} />
        <Route
          path="/me"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />
        <Route
          path="/d/:id"
          element={
            <RequireAuth>
              <Editor />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import Home from './pages/Home'
import Editor from './pages/Editor'
import GhostDoor from './pages/GhostDoor'
import Public from './pages/Public'
import Landing from './pages/Landing'
import Profile from './pages/Profile'
import UserPublic from './pages/UserPublic'
import Updates from './pages/Updates'
import Admin from './pages/Admin'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import { me, refreshMe } from './api'

// the browser keeps the old scroll position across client-side navigations;
// reset to the top on every path change (hash links still win)
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

function RequireAccount({ children }: { children: JSX.Element }) {
  const location = useLocation()
  const m = me()
  if (!m || m.anon) {
    const dest = location.pathname + location.search + location.hash
    return <Navigate to={`/login?next=${encodeURIComponent(dest)}`} replace />
  }
  return children
}

// Rendered fresh on every navigation to "/", so the auth check isn't frozen
// at App mount (route `element`s are created once per App render).
function RootGate() {
  useLocation()
  const m = me()
  return m && !m.anon ? <Home /> : <Landing />
}

export default function App() {
  // reconcile the local mirror with the real cookie session once per load;
  // also lets better-auth roll the session cookie so ghosts don't expire
  useEffect(() => {
    refreshMe()
  }, [])
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/p/:slug" element={<Public />} />
        <Route path="/u/:username" element={<UserPublic />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/" element={<RootGate />} />
        <Route
          path="/admin"
          element={
            <RequireAccount>
              <Admin />
            </RequireAccount>
          }
        />
        <Route
          path="/me"
          element={
            <RequireAccount>
              <Profile />
            </RequireAccount>
          }
        />
        <Route
          path="/d/:id"
          element={
            <GhostDoor>
              <Editor />
            </GhostDoor>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

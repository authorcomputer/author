import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { authClient } from '../auth-client'
import { api, me, refreshMe } from '../api'
import { track } from '../analytics'
import Logo from '../Logo'

// The reviewer's door: someone followed a shared draft link with no session.
// No account wall — a name to sign their notes with is enough. We mint a
// ghost (same as the landing page's writing door) and let them straight in.
export default function GhostDoor({ children }: { children: JSX.Element }) {
  const location = useLocation()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [entered, setEntered] = useState(() => !!me())

  async function enter(e: React.FormEvent) {
    e.preventDefault()
    const pen = name.replace(/\s+/g, ' ').trim()
    if (!pen || busy) return
    setBusy(true)
    setErr('')
    try {
      // trust the cookie over the local mirror — a signed-in user with a
      // wiped mirror must not be demoted to a ghost
      let m = await refreshMe()
      if (!m) {
        const result = await authClient.signIn.anonymous()
        if (result.error) throw new Error(result.error.message)
        m = await refreshMe()
        track('ghost: entered through a shared link')
      }
      if (m?.anon) {
        await api('/api/name', { method: 'POST', body: JSON.stringify({ name: pen }) })
        await refreshMe()
      }
      setEntered(true)
    } catch (e: any) {
      setErr(e?.message || 'the door stuck — try again in a moment')
      setBusy(false)
    }
  }

  if (entered) return children

  const dest = location.pathname + location.search + location.hash
  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={enter}>
        <h1>
          <Logo word size={20} />
        </h1>
        <div className="faint">someone shared a draft with you</div>
        <div className="ascii-rule" style={{ margin: '20px 0 8px' }}>
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        </div>
        <div className="faint" style={{ margin: '10px 0 14px', fontSize: 11 }}>
          no account needed — just a name, so your notes and edits are signed.
        </div>
        <div className="field">
          <input
            placeholder="your name"
            value={name}
            autoFocus
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button className="go" type="submit" disabled={busy || !name.trim()}>
          {busy ? '…' : '[ open the draft ]'}
        </button>
        {err && <div className="err">✗ {err}</div>}
        <div className="faint" style={{ marginTop: 40, fontSize: 11 }}>
          have a desk here?{' '}
          <Link to={`/login?next=${encodeURIComponent(dest)}`}>[ sign in ]</Link>
        </div>
      </form>
    </div>
  )
}

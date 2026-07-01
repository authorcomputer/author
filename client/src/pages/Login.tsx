import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from '../auth-client'
import { refreshMe } from '../api'
import { track } from '../analytics'
import Logo from '../Logo'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const [params] = useSearchParams()

  function goNext() {
    const next = params.get('next')
    // internal paths only — reject protocol-relative (//host) redirects
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/')
  }

  async function go(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      if (mode === 'in') {
        const ident = username.trim()
        const result = ident.includes('@')
          ? await authClient.signIn.email({ email: ident, password })
          : await authClient.signIn.username({ username: ident.toLowerCase(), password })
        if (result.error) throw new Error(result.error.message || 'wrong name or password')
      } else {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'no luck')
      }
      track(mode === 'in' ? 'user: signed in' : 'user: signed up', { via: 'door' })
      await refreshMe()
      goNext()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={go}>
        <h1>
          <Logo word size={20} />
        </h1>
        <div className="faint">a quiet place to write</div>
        <div className="ascii-rule" style={{ margin: '20px 0 8px' }}>
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        </div>
        {mode === 'in' ? (
          <div className="field">
            <input
              placeholder="name or email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoCapitalize="none"
            />
          </div>
        ) : (
          <div className="field">
            <input
              placeholder="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              autoCapitalize="none"
            />
          </div>
        )}
        <div className="field">
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {mode === 'up' && (
          <div className="faint" style={{ marginTop: 10, fontSize: 11 }}>
            pick a fresh password — not one you use elsewhere. you'll get a
            pen name you can change in settings.
          </div>
        )}
        <button className="go" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'in' ? '[ enter ]' : '[ take a desk ]'}
        </button>
        {err && <div className="err">✗ {err}</div>}
        <div className="faint" style={{ marginTop: 40, fontSize: 11 }}>
          {mode === 'in' ? (
            <>
              new here?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('up')
                  setErr('')
                }}
              >
                [ create an account ]
              </button>
            </>
          ) : (
            <>
              already have a desk?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('in')
                  setErr('')
                }}
              >
                [ sign in ]
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}

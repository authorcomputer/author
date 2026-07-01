import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAuth } from '../api'
import Logo from '../Logo'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const [params] = useSearchParams()

  async function go(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const res = await fetch(mode === 'in' ? '/api/login' : '/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'in' ? { username, password } : { username, email, password, code }
        ),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'no luck')
      const data = await res.json()
      setAuth(data.token, data.username)
      const next = params.get('next')
      // internal paths only — reject protocol-relative (//host) redirects
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/')
    } catch (e: any) {
      setErr(e.message)
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
        <div className="field">
          <input
            placeholder={mode === 'in' ? 'name or email' : 'pick a handle'}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="none"
          />
        </div>
        {mode === 'up' && (
          <div className="field">
            <input
              placeholder="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
          <div className="field">
            <input
              placeholder="invite code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="none"
            />
          </div>
        )}
        {mode === 'up' && (
          <div className="faint" style={{ marginTop: 10, fontSize: 11 }}>
            pick a fresh password — not one you use elsewhere.
          </div>
        )}
        <button className="go" type="submit">
          {mode === 'in' ? '[ enter ]' : '[ take a desk ]'}
        </button>
        {err && <div className="err">✗ {err}</div>}
        <div className="faint" style={{ marginTop: 40, fontSize: 11 }}>
          {mode === 'in' ? (
            <>
              have an invite?{' '}
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

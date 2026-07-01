import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAuth } from '../api'
import Logo from '../Logo'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const [params] = useSearchParams()

  async function go(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
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
            placeholder="name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="none"
          />
        </div>
        <div className="field">
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="go" type="submit">
          [ enter ]
        </button>
        {err && <div className="err">✗ {err}</div>}
        <div className="faint" style={{ marginTop: 40, fontSize: 11 }}>
          test desks: <b>ink</b> or <b>quill</b> · password: <b>author</b>
        </div>
      </form>
    </div>
  )
}

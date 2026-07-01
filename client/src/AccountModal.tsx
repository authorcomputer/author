import { useState } from 'react'
import { refreshMe } from './api'
import { track } from './analytics'

// The one prompt a ghost sees: create an account to keep what they wrote.
export default function AccountModal({
  reason,
  onClose,
}: {
  reason: string
  onClose: () => void
}) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, code }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'no luck')
      track('user: signed up', { via: 'ghost prompt' })
      await refreshMe()
      // this browser can nag the next ghost afresh
      localStorage.removeItem('author.ghost-nagged')
      // the ghost's pages were just linked to the new account — reload so
      // ownership, presence names, and the top bar all reflect it
      location.reload()
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <form className="cmdk account-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="cmdk-head">{reason}</div>
        <div className="hint" style={{ marginBottom: 14 }}>
          take a desk — everything you've written as a ghost comes with you.
        </div>
        <div className="field">
          <input
            placeholder="pick a handle"
            value={username}
            autoFocus
            autoCapitalize="none"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <input
            placeholder="email"
            type="email"
            value={email}
            autoCapitalize="none"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <input
            placeholder="password (fresh, not reused)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <input
            placeholder="invite code"
            value={code}
            autoCapitalize="none"
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="ai-actions" style={{ marginTop: 18 }}>
          <button type="submit" disabled={busy}>
            {busy ? 'setting up…' : '[ take a desk ]'}
          </button>
          <button type="button" className="faint" onClick={onClose}>
            keep drifting
          </button>
        </div>
        {err && <div className="err">✗ {err}</div>}
      </form>
    </div>
  )
}

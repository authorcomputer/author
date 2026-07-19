import { useState } from 'react'

// the lamp: the reader's own switch, on every page for every visitor —
// ghosts and passersby included. the choice belongs to the browser, not
// the account; index.html reads it back before first paint.
export default function Lamp() {
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'
  )
  const flip = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    if (next === 'dark') document.documentElement.dataset.mode = 'dark'
    else delete document.documentElement.dataset.mode
    try {
      localStorage.setItem('author-mode', next)
    } catch {}
    setMode(next)
  }
  return (
    <button
      className="lamp"
      onClick={flip}
      title={mode === 'dark' ? 'write by daylight' : 'write by lamplight'}
      aria-label={mode === 'dark' ? 'switch to light mode' : 'switch to dark mode'}
    >
      {mode === 'dark' ? '☀' : '☾'}
    </button>
  )
}

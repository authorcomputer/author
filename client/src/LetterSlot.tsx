import { useState } from 'react'
import { track } from './analytics'

// the slot in the door: an address goes in, a confirmation email comes
// back. the server's answer is deliberately flat, so the slot only ever
// says the note was dropped — never what became of it.
export default function LetterSlot({ author }: { author: string }) {
  const [addr, setAddr] = useState('')
  const [dropped, setDropped] = useState(false)
  const valid = /^\S+@\S+\.\S+$/.test(addr)

  async function drop() {
    if (!valid) return
    track('letterbox: address dropped')
    await fetch(`/api/letterbox/${author}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addr }),
    }).catch(() => {})
    setDropped(true)
  }

  if (dropped)
    return <div className="faint letter-slot">✉ a confirmation is on its way to {addr}</div>
  return (
    <div className="letter-slot" style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
      <input
        style={{ flex: 1, minWidth: 0, borderBottom: '1px solid var(--fainter)' }}
        placeholder="your@address"
        autoCapitalize="none"
        inputMode="email"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && drop()}
      />
      <button onClick={drop} disabled={!valid} style={{ whiteSpace: 'nowrap' }}>
        [ ✉ letters from {author} ]
      </button>
    </div>
  )
}

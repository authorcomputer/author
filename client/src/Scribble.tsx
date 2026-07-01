import { useEffect, useState } from 'react'

// The waiting pen: a line writes itself over and over while the model reads,
// with a rotating murmur underneath. Perceived speed is speed.
export default function Scribble({ phrases }: { phrases: string[] }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 90)
    return () => clearInterval(t)
  }, [])
  const W = 22
  const pos = tick % (W + 8) // linger a beat at the end of each line
  const line = '~'.repeat(Math.min(pos, W)) + '✎'
  const phrase = phrases[Math.floor(tick / 28) % phrases.length]
  return (
    <div className="scribble" aria-live="polite">
      <div className="scribble-line">{line}</div>
      <div className="hint">{phrase}</div>
    </div>
  )
}

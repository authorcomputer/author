import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Logo from '../Logo'
import { api, colorFor, me, refreshMe } from '../api'
import { track } from '../analytics'
import { authClient } from '../auth-client'

const REPO_URL = 'https://github.com/authorcomputer/author'
const INK = colorFor('ink')
const QUILL = colorFor('quill')

const FEATURES = [
  {
    glyph: '✎',
    name: 'live collaboration',
    blurb:
      'share a link, sign in once, and you are in the draft together — named cursors, no refresh, no conflicts.',
  },
  {
    glyph: '⌘K',
    name: 'commands',
    blurb:
      'select a passage, say what you want — improve it, shorten it, warm it up — preview, then replace.',
  },
  {
    glyph: '?',
    name: 'ask',
    blurb:
      'an editor that reads the whole draft and tells you what works, what drags, and what to fix first.',
  },
  {
    glyph: '✓',
    name: 'proof',
    blurb:
      'a proof-read for exactly what you pick — spelling, grammar, clichés, hedging, or a check in your own words. each issue clickable, each with a fix.',
  },
  {
    glyph: '↺',
    name: 'versions',
    blurb:
      'try a different way of saying it without losing what you had. name a snapshot, restore it any time.',
  },
  {
    glyph: '✽',
    name: 'publishing',
    blurb:
      'flip a draft into a quiet, read-only page anyone can visit. unpublish just as easily.',
  },
]

/* ------------------------------------------------------------------ */
/* the little play that loops in the mock editor: ink and quill wander */
/* the page, try a line, think better of it, and put it back           */
/* ------------------------------------------------------------------ */

const P1 =
  'The lighthouse keeper counted ships the way other men counted debts. Each one that passed safely was a small forgiveness; each one that did not was a weight he carried up the spiral stairs.'
const P2 =
  'His daughter wrote to him in the spring, and her letters smelled faintly of a city he had never seen.'

const after = (s: string, anchor: string) => s.indexOf(anchor) + anchor.length

type Actor = 'ink' | 'quill'
type Op =
  | { t: 'pause'; ms: number }
  | { t: 'move'; who: Actor; to: number }
  | { t: 'type'; who: Actor; text: string }
  | { t: 'erase'; who: Actor; count: number } // undo, one keystroke at a time

const INK_TRY = ', almost a mercy'
const QUILL_TRY = ' He read each one twice.'

// move targets are offsets into the *base* text, so every move happens
// after the erases have put the paragraph back
const SCRIPT: Op[] = [
  { t: 'pause', ms: 1400 },
  { t: 'move', who: 'quill', to: after(P2, 'never seen.') },
  { t: 'type', who: 'ink', text: INK_TRY },
  { t: 'pause', ms: 600 },
  { t: 'type', who: 'quill', text: QUILL_TRY },
  { t: 'pause', ms: 1300 },
  { t: 'erase', who: 'ink', count: INK_TRY.length },
  { t: 'pause', ms: 500 },
  { t: 'erase', who: 'quill', count: QUILL_TRY.length },
  { t: 'pause', ms: 400 },
  { t: 'move', who: 'ink', to: after(P1, 'counted debts.') },
  { t: 'pause', ms: 900 },
  { t: 'move', who: 'ink', to: after(P1, 'forgiveness') },
  { t: 'move', who: 'quill', to: after(P2, 'in the spring') },
  { t: 'pause', ms: 1800 },
]

type Scene = { p1: string; p2: string; ink: number; quill: number }
const OPENING: Scene = {
  p1: P1,
  p2: P2,
  ink: after(P1, 'forgiveness'),
  quill: after(P2, 'in the spring'),
}

function MockScene() {
  const [scene, setScene] = useState(OPENING)

  useEffect(() => {
    // for reduced motion the opening tableau stands on its own
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        timer = setTimeout(r, ms)
      })
    const paraOf = (who: Actor): 'p1' | 'p2' => (who === 'ink' ? 'p1' : 'p2')

    async function run() {
      while (alive) {
        // carets tracked here too so `move` can step without reading state
        const pos = { ink: OPENING.ink, quill: OPENING.quill }
        setScene(OPENING)
        for (const op of SCRIPT) {
          if (!alive) return
          if (op.t === 'pause') {
            await sleep(op.ms)
          } else if (op.t === 'type') {
            for (const ch of op.text) {
              if (!alive) return
              const k = paraOf(op.who)
              const i = pos[op.who]++
              setScene((s) => ({
                ...s,
                [k]: s[k].slice(0, i) + ch + s[k].slice(i),
                [op.who]: i + 1,
              }))
              await sleep(55 + Math.random() * 70)
            }
          } else if (op.t === 'erase') {
            for (let n = 0; n < op.count; n++) {
              if (!alive) return
              const k = paraOf(op.who)
              const i = pos[op.who]--
              setScene((s) => ({
                ...s,
                [k]: s[k].slice(0, i - 1) + s[k].slice(i),
                [op.who]: i - 1,
              }))
              await sleep(34)
            }
          } else {
            // amble a couple of characters at a time with an uneven rhythm —
            // quick enough to read as travel, slow enough to read as a person
            while (alive && pos[op.who] !== op.to) {
              const d = op.to - pos[op.who]
              pos[op.who] += Math.sign(d) * Math.min(3, Math.abs(d))
              setScene((s) => ({ ...s, [op.who]: pos[op.who] }))
              await sleep(38 + Math.random() * 34)
            }
          }
        }
      }
    }
    run()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const caret = (who: Actor) => {
    const color = who === 'ink' ? INK : QUILL
    return (
      <span className="mock-caret" style={{ borderColor: color }}>
        <span className="mock-flag" style={{ background: color }}>
          {who}
        </span>
      </span>
    )
  }

  return (
    <div className="mock-page">
      <div className="mock-title">the lighthouse keeper</div>
      <div className="ascii-rule">~~~~~~~~~~~~~~~~~~~~~~~~~~~~</div>
      <p>
        {scene.p1.slice(0, scene.ink)}
        {caret('ink')}
        {scene.p1.slice(scene.ink)}
      </p>
      <p>
        {scene.p2.slice(0, scene.quill)}
        {caret('quill')}
        {scene.p2.slice(scene.quill)}
      </p>
    </div>
  )
}

export default function Landing() {
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)

  // the ghost door: start writing with no account at all
  async function startWriting() {
    if (busy) return
    setBusy(true)
    try {
      // trust the cookie over the local mirror — a signed-in user with a
      // wiped mirror must not be demoted to a ghost
      let m = me() ?? (await refreshMe())
      if (m && !m.anon) return nav('/')
      if (!m) {
        const result = await authClient.signIn.anonymous()
        if (result.error) throw new Error(result.error.message)
        m = await refreshMe()
        track('ghost: started writing')
      }
      // a returning ghost picks up their latest page instead of minting one
      if (m?.anon) {
        const docs = await api('/api/docs')
        if (docs.length > 0) {
          track('ghost: resumed writing')
          return nav(`/d/${docs[0].id}`)
        }
      }
      const { id } = await api('/api/docs', { method: 'POST', body: '{}' })
      nav(`/d/${id}`)
    } catch {
      nav('/login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="landing">
      <header className="land-head">
        <Logo word />
        <div className="spacer" />
        <Link to="/updates">updates</Link>
        <Link to="/login">[ sign in ]</Link>
      </header>

      <section className="land-hero">
        <h1>
          A quiet place to write —{' '}
          <em>
            together<span className="accent">*</span>
          </em>
        </h1>
        <p className="land-sub">
          live cursors · an editor that reads · nothing in your way
        </p>
        <button className="land-cta" onClick={startWriting} disabled={busy}>
          {busy ? '…' : '[ start writing → ]'}
        </button>
        <div className="faint" style={{ marginTop: 12, fontSize: 11 }}>
          no account needed — the page is already yours
        </div>
      </section>

      <div className="ascii-rule land-rule">
        ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
      </div>

      <section className="land-mock" aria-hidden>
        <div className="mock-bar">
          <span>● two writing</span>
          <span className="spacer" />
          <span style={{ color: INK }}>ink</span>
          <span style={{ color: QUILL }}>+ quill</span>
          <span className="faint">1,204 words</span>
        </div>
        <MockScene />
      </section>

      <section className="land-grid">
        {FEATURES.map((f) => (
          <div className="land-card" key={f.name}>
            <div className="land-glyph accent">{f.glyph}</div>
            <div className="land-name">{f.name}</div>
            <div className="land-blurb">{f.blurb}</div>
          </div>
        ))}
      </section>

      <section className="land-open">
        <div className="ascii-rule">═══════════════════════════════════════════</div>
        <p>
          open source, MIT, yours to shape —{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ borderBottom: '1px dotted' }}>
            authorcomputer/author
          </a>
        </p>
      </section>

      <footer className="land-foot">
        <Logo word size={14} /> <span className="faint">· a quiet place to write ·</span>{' '}
        <Link className="faint" to="/updates">
          updates
        </Link>{' '}
        <span className="faint">·</span>{' '}
        <Link className="faint" to="/privacy">
          privacy
        </Link>{' '}
        <span className="faint">·</span>{' '}
        <Link className="faint" to="/terms">
          terms
        </Link>
      </footer>
    </div>
  )
}

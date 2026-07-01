import { useState } from 'react'
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
    name: 'checks',
    blurb:
      'spelling, grammar, repetition, clichés, clarity — each issue clickable, each with a suggested fix.',
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
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          github
        </a>
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
        <div className="mock-page">
          <div className="mock-title">the lighthouse keeper</div>
          <div className="ascii-rule">~~~~~~~~~~~~~~~~~~~~~~~~~~~~</div>
          <p>
            The lighthouse keeper counted ships the way other men counted debts.
            Each one that passed safely was a small forgiveness
            <span className="mock-caret" style={{ borderColor: INK }}>
              <span className="mock-flag" style={{ background: INK }}>
                ink
              </span>
            </span>
            ; each one that did not was a weight he carried up the spiral stairs.
          </p>
          <p>
            His daughter wrote to him in the spring
            <span className="mock-caret" style={{ borderColor: QUILL }}>
              <span className="mock-flag" style={{ background: QUILL }}>
                quill
              </span>
            </span>
            , and her letters smelled faintly of a city he had never seen.
          </p>
        </div>
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
        <Logo word size={14} /> <span className="faint">· a quiet place to write</span>
      </footer>
    </div>
  )
}

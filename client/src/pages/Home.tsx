import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, username, signOut } from '../api'
import Logo from '../Logo'
import Bubble from '../Bubble'
import Chart from '../Chart'
import NoteCorner from '../NoteCorner'
import { track } from '../analytics'

type DocRow = {
  id: string
  title: string
  updated_at: number
  published: boolean
  slug: string | null
  mine: boolean
  role: string
  review_token: string | null
  header_image: string | null
  snippet: string
  preview: string
  unseen: Record<string, number> | null
}

// a commenter's desk row opens the review door — the writing door would
// hand them the pen on the way in
function doorOf(d: DocRow) {
  return d.role === 'commenter' && d.review_token ? `/r/${d.review_token}` : `/d/${d.id}`
}

// the log's types folded to what a desk row can wear: notes, suggested
// edits, threads settled, and whether anyone wrote
function newsOf(u: Record<string, number> | null) {
  if (!u) return null
  const notes = (u['comment.add'] || 0) + (u['comment.reply'] || 0)
  const suggs = u['suggestion.add'] || 0
  const settled =
    (u['suggestion.accept'] || 0) + (u['suggestion.reject'] || 0) + (u['comment.resolve'] || 0)
  const wrote = (u['edit'] || 0) + (u['version.save'] || 0) > 0
  const sent = (u['send'] || 0) > 0
  if (!notes && !suggs && !settled && !wrote && !sent) return null
  return { notes, suggs, settled, wrote, sent }
}

function DocNews({ unseen }: { unseen: Record<string, number> | null }) {
  const n = newsOf(unseen)
  if (!n) return null
  const bits: [boolean, ReactNode, string][] = [
    [n.sent, '✉ sent to you', 'sent for your review'],
    [n.wrote, '✎ edited', 'edited'],
    [n.suggs > 0, `↳ ${n.suggs}`, 'suggested edits'],
    [n.notes > 0, <><Bubble /> {n.notes}</>, 'comments'],
    [n.settled > 0, `✓ ${n.settled}`, 'settled'],
  ]
  return (
    <span className="doc-news">
      {bits
        .filter(([on]) => on)
        .map(([, glyph, label]) => (
          <span className="accent" key={label} title={label}>
            {' · '}
            {glyph}
          </span>
        ))}
    </span>
  )
}

function ago(t: number) {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const PAGE = 30

export default function Home() {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [activity, setActivity] = useState<{ day: string; count: number }[] | null>(null)
  const [peek, setPeek] = useState<{ doc: DocRow; top: number } | null>(null)
  const nav = useNavigate()

  async function load() {
    setDocs(await api('/api/docs'))
    setLoaded(true)
  }
  useEffect(() => {
    load()
    api('/api/activity').then(setActivity).catch(() => {})
  }, [])

  async function newDraft() {
    track('doc: created', { via: 'desk' })
    const { id } = await api('/api/docs', { method: 'POST', body: '{}' })
    nav(`/d/${id}`)
  }

  async function del(e: React.MouseEvent, id: string) {
    e.preventDefault()
    if (!confirm('Toss this draft for everyone? There is no undo.')) return
    track('doc: deleted')
    await api(`/api/docs/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="home">
      <div className="home-head">
        <h1>
          <Logo word size={16} />{' '}
          <Link className="faint" to="/me" title="profile & settings">
            / {username()}
          </Link>
        </h1>
        <button onClick={newDraft}>[ + new draft ]</button>
      </div>
      <div className="ascii-rule">════════════════════════════════════════════════════════════</div>
      {/* when the window is too narrow for the rail, the chart moves in
          with the list — same chart, whichever home the CSS gives it */}
      {activity && activity.length > 0 && (
        <div className="desk-strip" aria-hidden>
          <Chart activity={activity} />
        </div>
      )}
      {docs.slice(0, shown).map((d) => (
        <Link
          className="doc-row"
          key={d.id}
          to={doorOf(d)}
          onMouseEnter={(e) => setPeek({ doc: d, top: e.currentTarget.getBoundingClientRect().top })}
          onMouseLeave={() => setPeek(null)}
        >
          {d.mine && (
            <button className="del" onClick={(e) => del(e, d.id)} title="delete">
              ✗
            </button>
          )}
          <div className="doc-title">{d.title || 'untitled'}</div>
          <div className="doc-meta">
            {ago(d.updated_at)}
            {!d.mine && (d.role === 'commenter' ? ' · for your review' : ' · shared with you')}
            {d.published && (
              <>
                {' · '}
                <span className="accent">✽ published</span>
              </>
            )}
            <DocNews unseen={d.unseen} />
          </div>
          {d.snippet && <div className="doc-snippet">{d.snippet}</div>}
        </Link>
      ))}
      {docs.length > shown && (
        <div className="show-older">
          <button className="faint" onClick={() => setShown((s) => s + 100)}>
            · · · show {docs.length - shown} older · · ·
          </button>
        </div>
      )}
      {loaded && docs.length === 0 && (
        <div className="empty-note">
          ( nothing here yet )
        </div>
      )}
      <div className="desk-rail" aria-hidden>
        {activity && activity.length > 0 && <Chart activity={activity} />}
      </div>
      {peek && (peek.doc.preview || peek.doc.header_image) && (
        <div
          className="desk-peek"
          aria-hidden
          style={{
            top: Math.max(
              activity && activity.length > 0 ? 210 : 76,
              Math.min(peek.top - 8, window.innerHeight - 340)
            ),
          }}
        >
          {peek.doc.header_image && <img src={peek.doc.header_image} alt="" />}
          <div className="peek-title">{peek.doc.title || 'untitled'}</div>
          <div className="ascii-rule">~~~~~~~~~~~~~~~~~~</div>
          <div className="peek-body">{peek.doc.preview}</div>
        </div>
      )}
      <NoteCorner />
      <div className="corner-nav">
        <Link className="faint" to="/updates" title="what changed, as it changed">
          updates
        </Link>
        <span className="faint">·</span>
        <Link className="faint" to="/me" title="profile & settings">
          profile
        </Link>
        <span className="faint">·</span>
        <button
          className="faint"
          onClick={async () => {
            await signOut()
            nav('/login')
          }}
        >
          leave
        </button>
      </div>
    </div>
  )
}

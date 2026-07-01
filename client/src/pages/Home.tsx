import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, username, signOut } from '../api'
import Logo from '../Logo'
import Chart from '../Chart'
import { track } from '../analytics'

type DocRow = {
  id: string
  title: string
  updated_at: number
  published: boolean
  slug: string | null
  mine: boolean
  header_image: string | null
  snippet: string
  preview: string
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
      {docs.slice(0, shown).map((d) => (
        <Link
          className="doc-row"
          key={d.id}
          to={`/d/${d.id}`}
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
            {!d.mine && ' · shared with you'}
            {d.published && (
              <>
                {' · '}
                <span className="accent">✽ published</span>
              </>
            )}
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
          ( nothing here yet — press [ + new draft ] and begin )
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
      <div className="corner-nav">
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

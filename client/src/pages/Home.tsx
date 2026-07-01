import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, username, clearAuth } from '../api'
import Logo from '../Logo'

type DocRow = {
  id: string
  title: string
  updated_at: number
  published: boolean
  slug: string | null
  mine: boolean
  snippet: string
}

function ago(t: number) {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Home() {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const nav = useNavigate()

  async function load() {
    setDocs(await api('/api/docs'))
    setLoaded(true)
  }
  useEffect(() => {
    load()
  }, [])

  async function newDraft() {
    const { id } = await api('/api/docs', { method: 'POST', body: '{}' })
    nav(`/d/${id}`)
  }

  async function del(e: React.MouseEvent, id: string) {
    e.preventDefault()
    if (!confirm('Toss this draft for everyone? There is no undo.')) return
    await api(`/api/docs/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="home">
      <div className="home-head">
        <h1>
          <Logo word size={16} /> <span className="faint">/ {username()}</span>
        </h1>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={newDraft}>[ + new draft ]</button>
          <button
            className="faint"
            onClick={() => {
              clearAuth()
              nav('/login')
            }}
          >
            leave
          </button>
        </div>
      </div>
      <div className="ascii-rule">════════════════════════════════════════════════════════════</div>
      {docs.map((d) => (
        <Link className="doc-row" key={d.id} to={`/d/${d.id}`}>
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
      {loaded && docs.length === 0 && (
        <div className="empty-note">
          ( nothing here yet — press [ + new draft ] and begin )
        </div>
      )}
    </div>
  )
}

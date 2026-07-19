import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, me } from '../api'
import { track } from '../analytics'
import Logo from '../Logo'
import Chart from '../Chart'
import Scribble from '../Scribble'

type Article = {
  title: string
  slug: string
  updated_at: number
  header_image: string | null
  preview: string
  // owner's view only: the piece's id (theirs already) and whether it shows
  id?: string
  listed?: boolean
}

type ProfileData = {
  username: string
  links: string[]
  activity: { day: string; count: number }[]
  articles: Article[]
  own?: boolean
  profile_public?: boolean
}

// a closed door with the asked-for name on the plate: maybe it's private,
// maybe nobody writes here by that name — either way, the pen inside is
// resting and the visitor gets a door of their own to try
function QuietProfile({ name }: { name: string }) {
  const plate = `/u/${name}`.slice(0, 24)
  // the door: a plaque with the asked-for name, a knob at hand height, and
  // a floor running past both jambs — a door stands in a wall, a box doesn't
  const w = Math.max(plate.length + 6, 16)
  const bar = (s: string) => {
    const total = w - s.length
    const l = Math.floor(total / 2)
    return '│' + ' '.repeat(l) + s + ' '.repeat(total - l) + '│'
  }
  const ground = '─'.repeat(6)
  const inset = ' '.repeat(ground.length)
  const door = [
    inset + '┌' + '─'.repeat(w) + '┐',
    inset + bar('┌' + '─'.repeat(plate.length + 2) + '┐'),
    inset + bar('│ ' + plate + ' │'),
    inset + bar('└' + '─'.repeat(plate.length + 2) + '┘'),
    inset + bar(''),
    inset + '│' + ' '.repeat(w - 4) + '●' + '   │',
    inset + bar(''),
    inset + bar(''),
    inset + bar(''),
    ground + '┴' + '─'.repeat(w) + '┴' + ground,
  ].join('\n')
  return (
    <div className="pub-wrap quiet-wrap">
      <pre className="quiet-door" aria-hidden>
        {door}
      </pre>
      <div className="faint">( this profile is quiet )</div>
      <div className="quiet-pen">
        <Scribble
          phrases={[
            'the curtains are drawn…',
            'perhaps they write at dawn…',
            'not even a comma stirs…',
            'a pen rests, somewhere inside…',
          ]}
        />
      </div>
      <div style={{ marginTop: 28 }}>
        {me() && !me()!.anon ? (
          <Link to="/">[ back to your desk ]</Link>
        ) : (
          <Link to="/login">[ take a desk of your own ]</Link>
        )}
      </div>
    </div>
  )
}

function linkLabel(url: string) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.replace(/\/$/, '')
    return host + (path.length > 1 && path.length <= 24 ? path : '')
  } catch {
    return url
  }
}

export default function UserPublic() {
  const { username: name } = useParams()
  const [p, setP] = useState<ProfileData | null>(null)
  const [missing, setMissing] = useState(false)
  const [peek, setPeek] = useState<{ a: Article; top: number } | null>(null)

  useEffect(() => {
    let stale = false
    setP(null)
    setMissing(false)
    fetch(`/api/profile/${name}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => !stale && setP(data))
      .catch(() => !stale && setMissing(true))
    return () => {
      stale = true
    }
  }, [name])

  useEffect(() => {
    if (p) document.title = `${p.username} · author*`
    return () => {
      document.title = 'author*'
    }
  }, [p])

  // the owner curates the page by standing in front of it: list or unlist
  // a piece where it appears (or would appear)
  async function toggle(a: Article) {
    const res = await api(`/api/docs/${a.id}/profile`, {
      method: 'POST',
      body: JSON.stringify({ show: !a.listed }),
    })
    track('doc: profile listing toggled', { on: res.on_profile, via: 'profile' })
    setP((prev) =>
      prev
        ? {
            ...prev,
            articles: prev.articles.map((x) =>
              x.id === a.id ? { ...x, listed: res.on_profile } : x
            ),
          }
        : prev
    )
  }

  return (
    <>
      <div className="pub-head">
        <Link to="/" title="author*">
          <Logo />
        </Link>
        <div className="spacer" />
        {me() && !me()!.anon ? (
          <Link to="/">[ your desk ]</Link>
        ) : (
          <Link to="/login">[ sign in &amp; write ]</Link>
        )}
      </div>
      {missing && <QuietProfile name={name || ''} />}
      {p && (
        <div className="pub-wrap">
          <h1 className="pub-title">{p.username}</h1>
          {p.own && !p.profile_public && (
            <div className="hint" style={{ marginTop: 4 }}>
              ( private — <Link to="/me">settings</Link> )
            </div>
          )}
          {p.links.length > 0 && (
            <div className="profile-links">
              {p.links.map((l, i) => (
                <a key={i} href={l} target="_blank" rel="noreferrer">
                  [{linkLabel(l)}]
                </a>
              ))}
            </div>
          )}
          {p.activity.length > 0 && (
            <div className="profile-chart">
              <Chart activity={p.activity} />
            </div>
          )}
          <div className="ascii-rule" style={{ margin: '24px 0 8px' }}>
            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          </div>
          {p.articles.length > 0 ? (
            p.articles.map((a) => (
              <Link
                className={p.own && !a.listed ? 'doc-row unlisted' : 'doc-row'}
                key={a.slug}
                to={`/p/${a.slug}`}
                onMouseEnter={(e) =>
                  setPeek({ a, top: e.currentTarget.getBoundingClientRect().top })
                }
                onMouseLeave={() => setPeek(null)}
              >
                {p.own && (
                  <button
                    className={a.listed ? 'del' : 'del list'}
                    onClick={(e) => {
                      e.preventDefault()
                      toggle(a)
                    }}
                    title={a.listed ? 'unlist' : 'list'}
                  >
                    {a.listed ? '✗' : '[ list ]'}
                  </button>
                )}
                <div className="doc-title">{a.title || 'untitled'}</div>
                <div className="doc-meta">
                  {new Date(a.updated_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                  {p.own && !a.listed && (
                    <>
                      {' · '}
                      <span>unlisted</span>
                    </>
                  )}
                </div>
              </Link>
            ))
          ) : (
            <div className="hint" style={{ marginTop: 16 }}>
              ( nothing published — yet )
            </div>
          )}
          {peek && (peek.a.preview || peek.a.header_image) && (
            <div
              className="desk-peek peek-hug"
              aria-hidden
              style={{ top: Math.max(76, Math.min(peek.top - 8, window.innerHeight - 340)) }}
            >
              {peek.a.header_image && <img src={peek.a.header_image} alt="" />}
              <div className="peek-title">{peek.a.title || 'untitled'}</div>
              <div className="ascii-rule">~~~~~~~~~~~~~~~~~~</div>
              <div className="peek-body">{peek.a.preview}</div>
            </div>
          )}
          <div className="pub-foot">
            ✽ writing on{' '}
            <Link to="/" style={{ borderBottom: '1px dotted' }}>
              author*
            </Link>
            {(!p.own || p.profile_public) && (
              <>
                {' · '}
                <a className="faint" href={`/u/${p.username}/feed.xml`}>
                  rss
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

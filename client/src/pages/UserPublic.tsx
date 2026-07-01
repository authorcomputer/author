import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { me } from '../api'
import Logo from '../Logo'
import Chart from '../Chart'

type ProfileData = {
  username: string
  links: string[]
  show_writing: boolean
  activity: { day: string; count: number }[]
  articles: { title: string; slug: string; updated_at: number }[]
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
      {missing && (
        <div className="pub-wrap">
          <div className="faint">( this profile is quiet )</div>
        </div>
      )}
      {p && (
        <div className="pub-wrap">
          <div className="profile-grid">
            <div className="profile-main">
              <h1 className="pub-title">{p.username}</h1>
              {p.links.length > 0 && (
                <div className="profile-links">
                  {p.links.map((l, i) => (
                    <a key={i} href={l} target="_blank" rel="noreferrer">
                      [{linkLabel(l)}]
                    </a>
                  ))}
                </div>
              )}
              <div className="ascii-rule" style={{ margin: '24px 0 8px' }}>
                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
              </div>
              {p.show_writing && p.articles.length > 0 ? (
                p.articles.map((a) => (
                  <Link className="doc-row" key={a.slug} to={`/p/${a.slug}`}>
                    <div className="doc-title">{a.title || 'untitled'}</div>
                    <div className="doc-meta">
                      {new Date(a.updated_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="hint" style={{ marginTop: 16 }}>
                  ( nothing published — yet )
                </div>
              )}
            </div>
            <aside className="profile-aside">
              <Chart activity={p.activity} />
            </aside>
          </div>
          <div className="pub-foot">
            ✽ writing on{' '}
            <Link to="/" style={{ borderBottom: '1px dotted' }}>
              author*
            </Link>
          </div>
        </div>
      )}
    </>
  )
}

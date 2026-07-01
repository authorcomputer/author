import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { token } from '../api'
import Logo from '../Logo'

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

const DAY_MS = 86400000

function Chart({ activity }: { activity: { day: string; count: number }[] }) {
  const [hover, setHover] = useState<{ day: string; count: number } | null>(null)
  const byDay = new Map(activity.map((a) => [a.day, a.count]))
  const days: { day: string; count: number }[] = []
  for (let i = 181; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10)
    days.push({ day: key, count: byDay.get(key) || 0 })
  }
  // pad to start on Sunday so columns are calendar weeks
  const pad = new Date(days[0].day + 'T00:00:00Z').getUTCDay()
  const cells: ({ day: string; count: number } | null)[] = [...Array(pad).fill(null), ...days]
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const level = (c: number) => (c === 0 ? 0 : c < 3 ? 1 : c < 8 ? 2 : c < 15 ? 3 : 4)
  const daysWriting = days.filter((d) => d.count > 0).length
  const fmt = (day: string) =>
    new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })

  return (
    <div className="contrib" onMouseLeave={() => setHover(null)}>
      <div className="contrib-grid">
        {weeks.map((week, w) => (
          <div className="contrib-col" key={w}>
            {week.map((c, d) => (
              <div
                key={d}
                className={`contrib-cell lv${c ? level(c.count) : 0} ${c ? '' : 'pad'} ${
                  hover && c && hover.day === c.day ? 'hovered' : ''
                }`}
                onMouseEnter={() => c && setHover(c)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="hint contrib-caption">
        {hover
          ? `${fmt(hover.day)} — ${hover.count === 0 ? 'a quiet day' : `wrote ${hover.count}×`}`
          : `${daysWriting} writing day${daysWriting === 1 ? '' : 's'} in the last six months`}
      </div>
    </div>
  )
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
        {token() ? (
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

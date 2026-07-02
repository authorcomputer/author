import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Logo from '../Logo'

type Stats = {
  writers: number
  ghosts: number
  members: number
  pages: number
  published: number
  words: number
  recent: { username: string; email: string; createdAt: string }[]
}

const nice = (n: number) => n.toLocaleString('en-US')

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    api('/api/admin/stats')
      .then(setStats)
      .catch(() => setMissing(true))
  }, [])

  return (
    <>
      <div className="pub-head">
        <Link to="/" title="author*">
          <Logo />
        </Link>
        <div className="spacer" />
        <Link to="/">[ your desk ]</Link>
      </div>
      <div className="pub-wrap">
        {missing && <div className="faint">( nothing published here )</div>}
        {stats && (
          <>
            <h1 className="pub-title">the back room</h1>
            <div className="faint">how the house is doing.</div>
            <div className="ascii-rule" style={{ marginTop: 8 }}>
              ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
            </div>
            <div style={{ margin: '20px 0', lineHeight: 2 }}>
              <div>
                {nice(stats.writers)} writer{stats.writers === 1 ? '' : 's'}{' '}
                <span className="faint">
                  ({nice(stats.members)} member{stats.members === 1 ? '' : 's'} ·{' '}
                  {nice(stats.ghosts)} ghost{stats.ghosts === 1 ? '' : 's'})
                </span>
              </div>
              <div>
                {nice(stats.pages)} page{stats.pages === 1 ? '' : 's'}{' '}
                <span className="faint">({nice(stats.published)} published)</span>
              </div>
              <div>
                {nice(stats.words)} words written{' '}
                <span className="faint">— about {Math.max(1, Math.round(stats.words / 90000))} novel{Math.round(stats.words / 90000) > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="ascii-rule">~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~</div>
            <div className="faint" style={{ margin: '16px 0 8px' }}>
              recent desks —
            </div>
            {stats.recent.map((u) => (
              <div className="update-row" key={u.email + u.createdAt}>
                <div className="u-time">
                  {new Date(u.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                <div className="u-title">
                  <Link to={`/u/${u.username}`}>{u.username}</Link>
                </div>
                <div className="u-note">{u.email}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import Logo from '../Logo'

type Stats = {
  writers: number
  ghosts: number
  members: number
  regulars: number
  pages: number
  published: number
  words: number
  recent: { username: string; email: string; createdAt: string; member: 0 | 1 }[]
}

const nice = (n: number) => n.toLocaleString('en-US')

// the back room's contents, chrome-free — the /admin page wraps it in the
// public shell, the profile's tab drops it in as-is
export function BackRoomBody() {
  const [stats, setStats] = useState<Stats | null>(null)
  // 'loading' → spinner; 'missing' → the not-admin decoy; 'error' → the
  // admin deserves to know the difference between locked out and broken
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')

  useEffect(() => {
    api('/api/admin/stats')
      .then((s) => {
        setStats(s)
        setState('ok')
      })
      .catch((e) => {
        setState(e instanceof ApiError && e.status === 404 ? 'missing' : 'error')
      })
  }, [])

  return (
    <>
      {state === 'loading' && <div className="faint">…</div>}
      {state === 'missing' && <div className="faint">( nothing published here )</div>}
      {state === 'error' && (
        <div className="faint">( the back room isn't answering — try again in a moment )</div>
      )}
      {state === 'ok' && stats && (
        <>
          <div className="faint">how the house is doing.</div>
          <div className="ascii-rule" style={{ marginTop: 8 }}>
            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          </div>
          <div style={{ margin: '20px 0', lineHeight: 2 }}>
            <div>
              {nice(stats.writers)} writer{stats.writers === 1 ? '' : 's'}{' '}
              <span className="faint">
                ({nice(stats.members)} member{stats.members === 1 ? '' : 's'} ·{' '}
                {nice(stats.regulars)} regular{stats.regulars === 1 ? '' : 's'} ·{' '}
                {nice(stats.ghosts)} ghost{stats.ghosts === 1 ? '' : 's'})
              </span>
            </div>
            <div>
              {nice(stats.pages)} page{stats.pages === 1 ? '' : 's'}{' '}
              <span className="faint">({nice(stats.published)} published)</span>
            </div>
            <div>
              {nice(stats.words)} words written
              {(() => {
                const novels = Math.round(stats.words / 90000)
                return novels >= 1 ? (
                  <span className="faint">
                    {' '}
                    — about {novels} novel{novels === 1 ? '' : 's'}
                  </span>
                ) : null
              })()}
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
                {u.username}
                {u.member === 1 && <span className="faint"> ✦ member</span>}
              </div>
              <div className="u-note">{u.email}</div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

export default function Admin() {
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
        <h1 className="pub-title">the back room</h1>
        <BackRoomBody />
      </div>
    </>
  )
}

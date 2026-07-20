import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { me } from '../api'
import Logo from '../Logo'
import { UPDATES } from '../updates'
import { attachSelectionInk } from '../highlight-ink'

export default function Updates() {
  // selecting text here pours wet highlighter ink under the cursor
  useEffect(() => attachSelectionInk(), [])

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
      <div className="pub-wrap">
        <h1 className="pub-title">updates</h1>
        <div className="faint">what changed, as it changed.</div>
        <div className="ascii-rule" style={{ marginTop: 8 }}>
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        </div>
        {UPDATES.map((day) => (
          <div className="update-row" key={day.date}>
            <div className="u-time">{day.date}</div>
            <div className="u-title">{day.title}</div>
            {day.blocks.map((b, i) =>
              b.kind === 'p' ? (
                <div className="u-p" key={i}>
                  {b.text}
                </div>
              ) : b.kind === 'bullet' ? (
                <div className="u-bullet" key={i}>
                  <span className="u-sym">✽</span>
                  <span>
                    <span className="u-head">{b.head}</span>
                    {b.text ? <> — {b.text}</> : null}
                  </span>
                </div>
              ) : (
                <div className="u-aside" key={i}>
                  <span className="u-sym">· · ·</span> {b.text}
                </div>
              ),
            )}
          </div>
        ))}
        <div className="pub-foot">
          ✽ written as it was built —{' '}
          <a
            href="https://github.com/authorcomputer/author/commits/main"
            target="_blank"
            rel="noreferrer"
            style={{ borderBottom: '1px dotted' }}
          >
            the full history
          </a>
        </div>
      </div>
    </>
  )
}

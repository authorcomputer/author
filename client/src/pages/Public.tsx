import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { me } from '../api'
import Logo from '../Logo'
import LetterSlot from '../LetterSlot'

export default function Public() {
  const { slug } = useParams()
  const [doc, setDoc] = useState<{
    title: string
    html: string
    header_image?: string | null
    author?: string
    author_public?: boolean
    letterbox?: boolean
  } | null>(null)
  const [missing, setMissing] = useState(false)
  const m = me()
  const signedIn = !!m && !m.anon

  useEffect(() => {
    // the component survives /p/a → /p/b (only the param changes), so a slow
    // response for the old slug must not land on the new page
    let stale = false
    setDoc(null)
    setMissing(false)
    fetch(`/api/public/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => !stale && setDoc(data))
      .catch(() => !stale && setMissing(true))
    return () => {
      stale = true
    }
  }, [slug])

  useEffect(() => {
    if (doc?.title) document.title = `${doc.title} · author*`
    return () => {
      document.title = 'author*'
    }
  }, [doc])

  return (
    <>
      <div className="pub-head">
        <Link to="/" title="author*">
          <Logo />
        </Link>
        <div className="spacer" />
        {doc?.author && (
          <span className="faint pub-pitch">
            written by{' '}
            {doc.author_public ? (
              <Link to={`/u/${doc.author}`} style={{ borderBottom: '1px dotted' }}>
                {doc.author}
              </Link>
            ) : (
              doc.author
            )}
          </span>
        )}
        {signedIn ? (
          <Link to="/">[ your desk ]</Link>
        ) : (
          <Link to="/login">[ sign in &amp; write ]</Link>
        )}
      </div>
      {missing && !doc && (
        <div className="pub-wrap">
          <div className="faint">( nothing published here )</div>
        </div>
      )}
      {doc && (
        <div className="pub-wrap">
          {doc.header_image && (
            <img className="pub-header-img" src={doc.header_image} alt="" />
          )}
          <h1 className="pub-title">{doc.title}</h1>
          <div className="ascii-rule" style={{ marginBottom: 32 }}>
            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          </div>
          <div className="pub-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
          {doc.letterbox && doc.author && (
            <div style={{ marginTop: 40 }}>
              <LetterSlot author={doc.author} />
            </div>
          )}
          <div className="pub-foot">
            ✽ set down with{' '}
            <Link to="/" style={{ borderBottom: '1px dotted' }}>
              author*
            </Link>
          </div>
        </div>
      )}
    </>
  )
}

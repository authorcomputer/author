import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { token } from '../api'
import Logo from '../Logo'

export default function Public() {
  const { slug } = useParams()
  const [doc, setDoc] = useState<{
    title: string
    html: string
    header_image?: string | null
  } | null>(null)
  const [missing, setMissing] = useState(false)
  const signedIn = !!token()

  useEffect(() => {
    setDoc(null)
    setMissing(false)
    fetch(`/api/public/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then(setDoc)
      .catch(() => setMissing(true))
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
        {signedIn ? (
          <Link to="/">[ your desk ]</Link>
        ) : (
          <>
            <span className="faint pub-pitch">written together on author*</span>
            <Link to="/login">[ sign in &amp; write ]</Link>
          </>
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

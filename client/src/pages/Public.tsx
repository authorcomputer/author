import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

export default function Public() {
  const { slug } = useParams()
  const [doc, setDoc] = useState<{ title: string; html: string } | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    fetch(`/api/public/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then(setDoc)
      .catch(() => setMissing(true))
  }, [slug])

  if (missing)
    return (
      <div className="pub-wrap">
        <div className="faint">( nothing published here )</div>
      </div>
    )
  if (!doc) return null

  return (
    <div className="pub-wrap">
      <h1 className="pub-title">{doc.title}</h1>
      <div className="ascii-rule" style={{ marginBottom: 32 }}>
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      </div>
      <div className="pub-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
      <div className="pub-foot">
        ✽ set down with{' '}
        <a href="/" style={{ borderBottom: '1px dotted' }}>
          author*
        </a>
      </div>
    </div>
  )
}

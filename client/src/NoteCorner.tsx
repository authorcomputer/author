import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from './api'
import { track } from './analytics'
import { docFromText } from './make-doc'

// the desk's corner: quick slips, not pages. they stay where they are —
// a click opens one in place, and [ → a page ] is the only way out.
type Note = { id: string; text: string; title: string; group_label: string; updated_at: number }

const SHOWN = 5

const labelOf = (n: Note) =>
  n.title || n.text.replace(/\s+/g, ' ').trim().slice(0, 44) || '( blank )'

export default function NoteCorner() {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [params, setParams] = useSearchParams()
  const opened = useRef(false)

  async function load() {
    try {
      setNotes(await api('/api/notes'))
    } catch {
      setNotes([])
    }
  }
  useEffect(() => {
    load()
  }, [])

  // author.computer/note lands here: a fresh slip, already open
  useEffect(() => {
    if (params.get('note') !== 'new' || opened.current) return
    opened.current = true
    setParams({}, { replace: true })
    newNote()
  }, [params])

  async function newNote() {
    track('note: created')
    try {
      const { id } = await api('/api/notes', { method: 'POST', body: '{}' })
      await load()
      setOpenId(id)
    } catch {
      /* the corner may be full — the quiet no is the message */
    }
  }

  if (!notes) return null
  const open = openId ? notes.find((n) => n.id === openId) : null
  const shown = all ? notes : notes.slice(0, SHOWN)

  return (
    <>
      <div className="note-corner" aria-label="notes">
        <button className="faint" onClick={newNote}>
          [ + note ]
        </button>
        <div className="note-stack">
          {shown.map((n) => (
            <button className="postit" key={n.id} onClick={() => setOpenId(n.id)}>
              {labelOf(n)}
            </button>
          ))}
        </div>
        {notes.length > SHOWN && (
          <button className="faint" onClick={() => setAll((a) => !a)}>
            {all ? '· fewer ·' : `· ${notes.length - SHOWN} more ·`}
          </button>
        )}
      </div>
      {open && (
        <NotePop
          key={open.id}
          note={open}
          onClose={() => {
            setOpenId(null)
            load()
          }}
          onGone={() => {
            setOpenId(null)
            load()
          }}
        />
      )}
    </>
  )
}

function NotePop({ note, onClose, onGone }: { note: Note; onClose: () => void; onGone: () => void }) {
  const [text, setText] = useState(note.text)
  const nav = useNavigate()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const latest = useRef(note.text)
  const saved = useRef(note.text)

  const save = async (t: string) => {
    if (t === saved.current) return
    saved.current = t
    await api(`/api/notes/${note.id}`, { method: 'POST', body: JSON.stringify({ text: t }) }).catch(
      () => {}
    )
  }

  function onEdit(t: string) {
    setText(t)
    latest.current = t
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(latest.current), 600)
  }

  // the pen lifts, the slip keeps what it heard
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      save(latest.current)
    },
    []
  )

  async function toss() {
    if (!confirm('Toss this note? There is no undo.')) return
    track('note: tossed')
    clearTimeout(timer.current)
    await api(`/api/notes/${note.id}`, { method: 'DELETE' }).catch(() => {})
    onGone()
  }

  async function promote() {
    track('note: promoted to page')
    clearTimeout(timer.current)
    await save(latest.current)
    const first = latest.current.split('\n').find((l) => l.trim()) || ''
    const title = note.title || first.trim().slice(0, 80) || 'untitled'
    try {
      const id = await docFromText(title, latest.current)
      await api(`/api/notes/${note.id}`, { method: 'DELETE' }).catch(() => {})
      nav(`/d/${id}`)
    } catch {
      /* the note stays — trying again is one click */
    }
  }

  return (
    <>
      <div className="share-backdrop" onClick={onClose} />
      <div className="note-pop">
        <textarea
          autoFocus
          placeholder="jot it down…"
          value={text}
          onChange={(e) => onEdit(e.target.value)}
        />
        <div className="row-actions">
          <button onClick={promote} title="the note becomes a draft and leaves the corner">
            [ → a page ]
          </button>
          <button className="faint" onClick={toss} title="toss">
            ✗
          </button>
        </div>
      </div>
    </>
  )
}

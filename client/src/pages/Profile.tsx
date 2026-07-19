import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StarterKit from '@tiptap/starter-kit'
import TiptapLink from '@tiptap/extension-link'
import { getSchema } from '@tiptap/core'
import { generateJSON } from '@tiptap/html'
import { marked } from 'marked'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import { api, localDay, setMe, username } from '../api'
import { track } from '../analytics'
import Bubble from '../Bubble'
import { CommentMark } from '../comment-mark'
import Logo from '../Logo'
import PasswordInput from '../PasswordInput'

type Settings = {
  username: string
  profile_public: boolean
  links: string[]
}

type ImportItem = {
  name: string
  status: 'waiting' | 'importing' | 'done' | 'failed'
  docId?: string
  error?: string
}

const IMPORT_EXTENSIONS = [StarterKit, TiptapLink, CommentMark]
const importSchema = getSchema(IMPORT_EXTENSIONS)

async function importMarkdownFile(file: File): Promise<string> {
  const text = await file.text()
  let title = file.name.replace(/\.(md|markdown|txt)$/i, '')
  let md = text
  // a leading "# heading" becomes the title
  const m = md.match(/^#[ \t]+(.+)[ \t]*\r?\n+/)
  if (m) {
    title = m[1].trim()
    md = md.slice(m[0].length)
  }
  const html = await marked.parse(md)

  const { id } = await api('/api/docs', { method: 'POST', body: JSON.stringify({ title }) })

  // markdown → tiptap JSON → a Yjs update, merged into the doc's live room
  const json = generateJSON(html, IMPORT_EXTENSIONS)
  const update = Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(importSchema, json, 'default'))

  const ydoc = new Y.Doc()
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const provider = new WebsocketProvider(`${proto}//${location.host}/ws`, id, ydoc)
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sync timeout')), 10000)
      provider.once('sync', () => {
        clearTimeout(t)
        resolve()
      })
    })
    Y.applyUpdate(ydoc, update)
    ydoc.getMap('meta').set('title', title)
    await api(`/api/docs/${id}/html`, {
      method: 'POST',
      body: JSON.stringify({ html, day: localDay() }),
    })
    // give the websocket a beat to flush before tearing down
    await new Promise((r) => setTimeout(r, 400))
  } catch (e) {
    // don't leave an orphaned empty draft behind on a failed import
    await api(`/api/docs/${id}`, { method: 'DELETE' }).catch(() => {})
    throw e
  } finally {
    provider.destroy()
    ydoc.destroy()
  }
  return id
}

export default function Profile() {
  const [tab, setTab] = useState<'settings' | 'import'>('settings')
  return (
    <div className="home">
      <div className="home-head">
        <h1>
          <Link to="/">
            <Logo word size={16} />
          </Link>{' '}
          <span className="faint">/ {username()}</span>
        </h1>
        <Link to="/">← desk</Link>
      </div>
      <div className="ascii-rule">════════════════════════════════════════════════════════════</div>
      <div className="profile-tabs">
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          [ settings ]
        </button>
        <button className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>
          [ import ]
        </button>
      </div>
      {tab === 'settings' ? <SettingsTab /> : <ImportTab />}
    </div>
  )
}

function SettingsTab() {
  const [s, setS] = useState<Settings | null>(null)
  const [linksText, setLinksText] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api('/api/settings').then((res: Settings) => {
      setS(res)
      setLinksText(res.links.join('\n'))
    })
  }, [])

  if (!s) return null

  async function save(next: Settings) {
    setS(next)
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        profile_public: next.profile_public,
        links: linksText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      }),
    })
    // resync with what the server actually kept (invalid links are filtered)
    const stored: Settings = await api('/api/settings')
    setS(stored)
    setLinksText(stored.links.join('\n'))
    track('profile: settings saved', { public: next.profile_public })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="profile-body">
      <div className="setting-row">
        <button onClick={() => save({ ...s, profile_public: !s.profile_public })}>
          {s.profile_public ? '[✓]' : '[ ]'} public profile
        </button>
        <div className="hint">
          {' '}
          {s.profile_public ? 'yours is at' : 'private —'}{' '}
          <Link className="accent" to={`/u/${s.username}`}>
            /u/{s.username}
          </Link>
        </div>
      </div>

      <HandleRow current={s.username} onRenamed={(u) => setS({ ...s, username: u })} />

      <FirstReadersRow />

      <LetterboxRow />

      <PasswordRow />

      <div className="setting-row">
        <div className="setting-h">social links</div>
        <textarea
          className="ask-box"
          placeholder={'https://x.com/you\nhttps://github.com/you'}
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Tab' || e.shiftKey) return
            // ⇥ finishes the scaffolding the placeholder shows: an empty
            // line gets its example's prefix, a half-typed one is completed.
            // when there's nothing to fill, the key keeps its focus job.
            const ta = e.currentTarget
            const at = ta.selectionStart
            const before = ta.value.slice(0, at)
            const line = before.slice(before.lastIndexOf('\n') + 1)
            const lineIdx = (before.match(/\n/g) || []).length
            const starts = ['https://x.com/', 'https://github.com/', 'https://']
            const first = starts[Math.min(lineIdx, starts.length - 1)]
            const pick = line
              ? [first, ...starts].find((p) => p.startsWith(line) && p !== line)
              : first
            if (!pick) return
            e.preventDefault()
            ta.setRangeText(pick.slice(line.length), at, ta.selectionEnd, 'end')
            setLinksText(ta.value)
          }}
        />
        <div className="ai-actions">
          <button onClick={() => save(s)}>{saved ? '✓ saved' : '[ save links ]'}</button>
          <span className="hint">one per line, up to six — ⇥ fills the https:// part</span>
        </div>
      </div>
    </div>
  )
}

function HandleRow({ current, onRenamed }: { current: string; onRenamed: (u: string) => void }) {
  const [name, setName] = useState(current)
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function rename() {
    try {
      const res = await api('/api/handle', {
        method: 'POST',
        body: JSON.stringify({ username: name }),
      })
      track('user: handle renamed')
      setMe({ username: res.username, anon: false })
      setName(res.username)
      onRenamed(res.username)
      setState('saved')
      setTimeout(() => setState('idle'), 1500)
    } catch (e: any) {
      setMsg(e.message)
      setState('error')
    }
  }

  return (
    <div className="setting-row">
      <div className="setting-h">handle</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <input
          style={{ flex: 1, borderBottom: '1px solid var(--fainter)' }}
          value={name}
          autoCapitalize="none"
          onChange={(e) => {
            setName(e.target.value)
            setState('idle')
          }}
        />
        <button onClick={rename} disabled={!name.trim() || name.trim() === current}>
          {state === 'saved' ? '✓ renamed' : '[ rename ]'}
        </button>
      </div>
      {state === 'error' && <div className="err">✗ {msg}</div>}
    </div>
  )
}

// the standing circle: handles the [ ✉ send ] button in a draft's share
// popover delivers to, each enrolled through the review door
function FirstReadersRow() {
  const [readers, setReaders] = useState<{ id: string; username: string }[] | null>(null)
  const [handle, setHandle] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api('/api/first-readers')
      .then((r) => setReaders(r.readers))
      .catch(() => {})
  }, [])

  async function add() {
    try {
      const r = await api('/api/first-readers', {
        method: 'POST',
        body: JSON.stringify({ handle }),
      })
      track('first readers: added', { count: r.readers.length })
      setReaders(r.readers)
      setHandle('')
      setMsg('')
    } catch (e: any) {
      setMsg(e.message)
    }
  }

  async function drop(id: string) {
    const r = await api(`/api/first-readers/${id}`, { method: 'DELETE' })
    track('first readers: removed', { count: r.readers.length })
    setReaders(r.readers)
  }

  if (!readers) return null
  return (
    <div className="setting-row">
      <div className="setting-h">✉ first readers</div>
      {readers.map((r) => (
        <div className="import-row" key={r.id}>
          <span className="faint">
            <Bubble />{' '}
          </span>
          <Link to={`/u/${r.username}`}>{r.username}</Link>{' '}
          <button className="faint" title="remove" onClick={() => drop(r.id)}>
            ✗
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, marginTop: readers.length ? 10 : 0 }}>
        <input
          style={{ flex: 1, borderBottom: '1px solid var(--fainter)' }}
          placeholder="their handle"
          autoCapitalize="none"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value)
            setMsg('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && handle.trim() && add()}
        />
        <button onClick={add} disabled={!handle.trim()}>
          [ add ]
        </button>
      </div>
      {msg && <div className="err">✗ {msg}</div>}
    </div>
  )
}

type Letterbox = {
  on: boolean
  subscribers: { id: string; email: string; confirmed: boolean }[]
  postage: { used: number; allowance: number }
  capacity: number
}

// the slot on the door: open it and readers can leave their address on
// your public pages; [ ✉ post ] in a published draft's share popover
// mails the piece to every confirmed one
function LetterboxRow() {
  const [box, setBox] = useState<Letterbox | null>(null)

  useEffect(() => {
    api('/api/letterbox').then(setBox).catch(() => {})
  }, [])

  if (!box) return null
  const confirmed = box.subscribers.filter((s) => s.confirmed)
  const waiting = box.subscribers.length - confirmed.length

  async function toggle() {
    if (!box) return
    track('letterbox: toggled', { on: !box.on })
    setBox(await api('/api/letterbox', { method: 'POST', body: JSON.stringify({ on: !box.on }) }))
  }

  async function drop(id: string) {
    setBox(await api(`/api/letterbox/${id}`, { method: 'DELETE' }))
  }

  return (
    <div className="setting-row">
      <button onClick={toggle}>{box.on ? '[✓]' : '[ ]'} ✉ letterbox</button>
      {box.on && (
        <>
          <div className="hint">
            {confirmed.length}/{box.capacity} addresses
            {waiting > 0 ? ` · ${waiting} unconfirmed` : ''} · postage {box.postage.used}/
            {box.postage.allowance} this month
          </div>
          {confirmed.map((s) => (
            <div className="import-row" key={s.id}>
              <span className="faint">✉ </span>
              {s.email}{' '}
              <button className="faint" title="remove" onClick={() => drop(s.id)}>
                ✗
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function PasswordRow() {
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function set() {
    try {
      // the server insists on the current password — a live session alone
      // is not allowed to hand the account to whoever is holding the tab
      await api('/api/password', {
        method: 'POST',
        body: JSON.stringify({ current: cur, password: pw }),
      })
      track('user: password changed')
      setCur('')
      setPw('')
      setState('saved')
      setTimeout(() => setState('idle'), 1500)
    } catch (e: any) {
      setMsg(e.message)
      setState('error')
    }
  }

  return (
    <div className="setting-row">
      <div className="setting-h">change password</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PasswordInput
          inputStyle={{ borderBottom: '1px solid var(--fainter)' }}
          placeholder="current password"
          value={cur}
          onChange={(v) => {
            setCur(v)
            setState('idle')
          }}
        />
        <div style={{ display: 'flex', gap: 12 }}>
          <PasswordInput
            style={{ flex: 1 }}
            inputStyle={{ borderBottom: '1px solid var(--fainter)' }}
            placeholder="new password"
            value={pw}
            onChange={(v) => {
              setPw(v)
              setState('idle')
            }}
          />
          <button onClick={set} disabled={!pw || !cur}>
            {state === 'saved' ? '✓ changed' : '[ set password ]'}
          </button>
        </div>
      </div>
      {state === 'error' && <div className="err">✗ {msg}</div>}
    </div>
  )
}

function ImportTab() {
  const [items, setItems] = useState<ImportItem[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [running, setRunning] = useState(false)

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    if (running) return
    const list = Array.from(e.target.files || [])
    setFiles(list)
    setItems(list.map((f) => ({ name: f.name, status: 'waiting' })))
  }

  async function run() {
    if (running || files.length === 0) return
    track('import: ran', { files: files.length })
    setRunning(true)
    for (let i = 0; i < files.length; i++) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'importing' } : it)))
      try {
        const docId = await importMarkdownFile(files[i])
        setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: 'done', docId } : it)))
      } catch (e: any) {
        setItems((prev) =>
          prev.map((it, j) => (j === i ? { ...it, status: 'failed', error: e.message } : it))
        )
      }
    }
    setRunning(false)
  }

  return (
    <div className="profile-body">
      <label className="file-pick">
        [ choose .md files ]
        <input
          type="file"
          multiple
          accept=".md,.markdown,.txt"
          style={{ display: 'none' }}
          onChange={pick}
        />
      </label>
      {items.length > 0 && (
        <>
          <div style={{ marginTop: 16 }}>
            {items.map((it, i) => (
              <div className="import-row" key={i}>
                <span className="faint">
                  {it.status === 'done' && '✓ '}
                  {it.status === 'failed' && '✗ '}
                  {it.status === 'importing' && '… '}
                  {it.status === 'waiting' && '· '}
                </span>
                {it.docId ? <Link to={`/d/${it.docId}`}>{it.name}</Link> : it.name}
                {it.error && <span className="err"> — {it.error}</span>}
              </div>
            ))}
          </div>
          <div className="ai-actions">
            <button onClick={run} disabled={running}>
              {running
                ? 'importing…'
                : `[ import ${files.length} file${files.length === 1 ? '' : 's'} ]`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

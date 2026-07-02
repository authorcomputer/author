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
import { CommentMark } from '../comment-mark'
import Logo from '../Logo'

type Settings = {
  username: string
  profile_public: boolean
  show_writing: boolean
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
        show_writing: next.show_writing,
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
    track('profile: settings saved', {
      public: next.profile_public,
      show_writing: next.show_writing,
    })
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
          a page anyone can visit — your published writing, your links, and your writing streak.
          {s.profile_public && (
            <>
              {' '}
              yours is at{' '}
              <Link className="accent" to={`/u/${s.username}`}>
                /u/{s.username}
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="setting-row">
        <button onClick={() => save({ ...s, show_writing: !s.show_writing })}>
          {s.show_writing ? '[✓]' : '[ ]'} list published pieces on profile
        </button>
        <div className="hint">only drafts you've explicitly published ever appear.</div>
        {s.show_writing && <ProfilePieces />}
      </div>

      <HandleRow current={s.username} onRenamed={(u) => setS({ ...s, username: u })} />

      <PasswordRow />

      <div className="setting-row">
        <div style={{ marginBottom: 6 }}>social links</div>
        <textarea
          className="ask-box"
          placeholder={'https://x.com/you\nhttps://github.com/you'}
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
        />
        <div className="ai-actions">
          <button onClick={() => save(s)}>{saved ? '✓ saved' : '[ save links ]'}</button>
          <span className="hint">one per line, up to six — full https:// urls</span>
        </div>
      </div>
    </div>
  )
}

type PieceRow = { id: string; title: string; published: boolean; mine: boolean; on_profile: boolean }

// pick which published pieces appear on the public profile
function ProfilePieces() {
  const [pieces, setPieces] = useState<PieceRow[]>([])

  useEffect(() => {
    api('/api/docs').then((docs: PieceRow[]) =>
      setPieces(docs.filter((d) => d.mine && d.published))
    )
  }, [])

  async function toggle(p: PieceRow) {
    const res = await api(`/api/docs/${p.id}/profile`, {
      method: 'POST',
      body: JSON.stringify({ show: !p.on_profile }),
    })
    track('doc: profile listing toggled', { on: res.on_profile })
    setPieces((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, on_profile: res.on_profile } : x))
    )
  }

  if (pieces.length === 0)
    return (
      <div className="hint" style={{ marginTop: 10 }}>
        ( nothing published yet — publish a page from its [ share ] menu and choose here )
      </div>
    )

  return (
    <div style={{ marginTop: 10 }}>
      {pieces.map((p) => (
        <div key={p.id} style={{ padding: '4px 0' }}>
          <button onClick={() => toggle(p)}>
            {p.on_profile ? '[✓]' : '[ ]'} {p.title || 'untitled'}
          </button>
        </div>
      ))}
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
      <div style={{ marginBottom: 6 }}>handle</div>
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
      <div className="hint">your name on cursors, comments, and your public page (/u/{current}).</div>
      {state === 'error' && <div className="err">✗ {msg}</div>}
    </div>
  )
}

function PasswordRow() {
  const [pw, setPw] = useState('')
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function set() {
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ password: pw }) })
      track('user: password changed')
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
      <div style={{ marginBottom: 6 }}>change password</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <input
          type="password"
          style={{ flex: 1, borderBottom: '1px solid var(--fainter)' }}
          placeholder="new password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value)
            setState('idle')
          }}
        />
        <button onClick={set} disabled={!pw}>
          {state === 'saved' ? '✓ changed' : '[ set password ]'}
        </button>
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
      <div className="hint" style={{ marginBottom: 14 }}>
        bring your writing with you — each .md file becomes its own draft. a leading
        “# heading” is used as the title.
      </div>
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

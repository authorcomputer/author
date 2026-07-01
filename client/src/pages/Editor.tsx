import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEditor, EditorContent, Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { api, apiStream, token, username, colorFor } from '../api'
import { CommentMark } from '../comment-mark'

type Meta = {
  id: string
  title: string
  published: boolean
  slug: string | null
  mine: boolean
  owner: string
}
type Comment = {
  id: string
  username: string
  quote: string
  text: string
  resolved: boolean
  created_at: number
}
type Issue = { excerpt: string; kind: string; note: string; suggestion: string }
type Version = { id: string; name: string; username: string; created_at: number }
type Panel = 'ai' | 'checks' | 'titles' | 'comments' | 'versions' | null

function docText(editor: TiptapEditor) {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
}

function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p>${p
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')}</p>`
    )
    .join('')
}

function findRange(editor: TiptapEditor, excerpt: string) {
  const needles = [excerpt, excerpt.slice(0, 24), excerpt.slice(0, 12)].filter(
    (n) => n.trim().length >= 4
  )
  for (const needle of needles) {
    let found: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isText || !node.text) return
      const idx = node.text.indexOf(needle)
      if (idx >= 0) found = { from: pos + idx, to: pos + idx + needle.length }
    })
    if (found) return found
  }
  return null
}

function selectRange(editor: TiptapEditor, range: { from: number; to: number }) {
  editor.chain().focus().setTextSelection(range).run()
  const el = editor.view.domAtPos(range.from).node as HTMLElement
  const target = el.nodeType === 3 ? el.parentElement : (el as HTMLElement)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function removeCommentMark(editor: TiptapEditor, id: string) {
  const { doc, schema } = editor.state
  const tr = editor.state.tr
  doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'comment' && mark.attrs.id === id) {
        tr.removeMark(pos, pos + node.nodeSize, schema.marks.comment)
      }
    })
  })
  if (tr.steps.length) editor.view.dispatch(tr)
}

export default function EditorPage() {
  const { id } = useParams()
  return <EditorInner key={id} id={id!} />
}

function EditorInner({ id }: { id: string }) {
  const me = username() || 'someone'
  const [meta, setMeta] = useState<Meta | null>(null)
  const [title, setTitle] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [gone, setGone] = useState(false)
  const [others, setOthers] = useState<{ name: string; color: string }[]>([])
  const [connected, setConnected] = useState(false)

  const ydoc = useMemo(() => new Y.Doc(), [id])
  const provider = useMemo(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return new WebsocketProvider(`${proto}//${location.host}/ws`, id, ydoc, {
      params: { token: token() || '' },
    })
  }, [id, ydoc])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: me, color: colorFor(me) },
      }),
      Placeholder.configure({ placeholder: 'begin…' }),
      CharacterCount,
      CommentMark,
    ],
  })

  // lifecycle: meta, presence, teardown
  useEffect(() => {
    api(`/api/docs/${id}`)
      .then((m: Meta) => {
        setMeta(m)
        const metaMap = ydoc.getMap('meta')
        const applyTitle = () => setTitle((metaMap.get('title') as string) ?? '')
        metaMap.observe(applyTitle)
        provider.on('sync', (synced: boolean) => {
          setConnected(synced)
          if (synced && metaMap.get('title') === undefined && m.title && m.title !== 'untitled') {
            metaMap.set('title', m.title)
          }
        })
        applyTitle()
      })
      .catch((e) => {
        if (e.message !== 'signed out') {
          setGone(true)
          provider.destroy() // stop the websocket retry loop for a missing doc
        }
      })
    const onAwareness = () => {
      const states = Array.from(provider.awareness.getStates().entries())
      const rest = states
        .filter(([cid]) => cid !== provider.awareness.clientID)
        .map(([, s]: any) => s.user)
        .filter(Boolean)
      setOthers(rest)
    }
    provider.awareness.on('change', onAwareness)
    const onStatus = ({ status }: any) => setConnected(status === 'connected')
    provider.on('status', onStatus)
    return () => {
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      ydoc.destroy()
    }
  }, [id, provider, ydoc])

  // debounced html snapshot for list snippets + published page
  const htmlTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!editor) return
    const push = () => {
      clearTimeout(htmlTimer.current)
      htmlTimer.current = setTimeout(() => {
        api(`/api/docs/${id}/html`, {
          method: 'POST',
          body: JSON.stringify({ html: editor.getHTML() }),
        }).catch(() => {})
      }, 2500)
    }
    editor.on('update', push)
    return () => {
      editor.off('update', push)
      clearTimeout(htmlTimer.current)
    }
  }, [editor, id])

  function updateTitle(v: string) {
    setTitle(v)
    ydoc.getMap('meta').set('title', v)
  }

  // ---------- publish ----------
  async function togglePublish() {
    if (!editor || !meta) return
    const res = await api(`/api/docs/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ publish: !meta.published, html: editor.getHTML() }),
    })
    setMeta({ ...meta, published: res.published, slug: res.slug })
  }

  const words = editor ? editor.storage.characterCount.words() : 0

  if (gone)
    return (
      <div className="home">
        <div className="empty-note">
          ( this draft is gone — it may have been deleted )
          <div style={{ marginTop: 16 }}>
            <Link to="/">← back to your desk</Link>
          </div>
        </div>
      </div>
    )

  return (
    <div className="ed-wrap">
      <div className="ed-top">
        <Link to="/">← desk</Link>
        <span className="faint">{connected ? '●' : '○'}</span>
        <div className="presence">
          <span className="who" style={{ color: colorFor(me) }}>
            {me}
          </span>
          {others.map((o, i) => (
            <span className="who" key={i} style={{ color: o.color }}>
              + {o.name}
            </span>
          ))}
        </div>
        <div className="spacer" />
        <span className="faint">{words} words</span>
        <button className={panel === 'ai' ? 'on' : ''} onClick={() => setPanel(panel === 'ai' ? null : 'ai')}>
          [ ask ]
        </button>
        <button
          className={panel === 'checks' ? 'on' : ''}
          onClick={() => setPanel(panel === 'checks' ? null : 'checks')}
        >
          [ checks ]
        </button>
        <button
          className={panel === 'titles' ? 'on' : ''}
          onClick={() => setPanel(panel === 'titles' ? null : 'titles')}
        >
          [ titles ]
        </button>
        <button
          className={panel === 'comments' ? 'on' : ''}
          onClick={() => setPanel(panel === 'comments' ? null : 'comments')}
        >
          [ comments ]
        </button>
        <button
          className={panel === 'versions' ? 'on' : ''}
          onClick={() => setPanel(panel === 'versions' ? null : 'versions')}
        >
          [ versions ]
        </button>
        <div className="share-anchor">
          <button
            className={shareOpen || meta?.published ? 'on' : ''}
            onClick={() => meta && setShareOpen(!shareOpen)}
          >
            {meta?.published ? '✽ share' : '[ share ]'}
          </button>
          {shareOpen && meta && (
            <SharePop meta={meta} onToggle={togglePublish} onClose={() => setShareOpen(false)} />
          )}
        </div>
      </div>
      <div className="ed-body">
        <div className="ed-scroll">
          <div className="ed-page">
            <input
              className="title-input"
              placeholder="untitled"
              value={title}
              onChange={(e) => updateTitle(e.target.value)}
            />
            <div className="ascii-rule">~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~</div>
            <EditorContent editor={editor} />
          </div>
        </div>
        {panel && editor && (
          <SidePanel
            panel={panel}
            setPanel={setPanel}
            editor={editor}
            docId={id}
            onTitle={(t) => updateTitle(t)}
          />
        )}
      </div>
      {editor && <CommandBar editor={editor} setPanel={setPanel} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* share popover                                                       */
/* ------------------------------------------------------------------ */

function SharePop({
  meta,
  onToggle,
  onClose,
}: {
  meta: Meta
  onToggle: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'write' | 'read' | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  const writeUrl = `${location.origin}/d/${meta.id}`
  const readUrl = meta.slug ? `${location.origin}/p/${meta.slug}` : null

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  function copy(url: string, which: 'write' | 'read') {
    // clipboard API is absent in non-secure contexts; the link is visible
    // either way, so failing quietly is fine.
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(which)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 1600)
  }

  return (
    <>
      <div className="share-backdrop" onClick={onClose} />
      <div className="share-pop">
        <div className="share-sec">
          <div className="share-h">✎ write together</div>
          <div className="hint">
            send this link. whoever opens it signs in once and lands in the draft
            with you — live, cursors and all.
          </div>
          <div className="share-link">{writeUrl}</div>
          <button onClick={() => copy(writeUrl, 'write')}>
            {copied === 'write' ? '✓ copied' : '[ copy writing link ]'}
          </button>
        </div>
        <div className="ascii-rule" style={{ margin: '12px 0' }}>
          · · · · · · · · · · · · · · · · · · ·
        </div>
        <div className="share-sec">
          <div className="share-h">✽ read only</div>
          {meta.published && readUrl ? (
            <>
              <div className="hint">a quiet public page anyone can read.</div>
              <div className="share-link">{readUrl}</div>
              <div style={{ display: 'flex', gap: 14 }}>
                <button onClick={() => copy(readUrl, 'read')}>
                  {copied === 'read' ? '✓ copied' : '[ copy reading link ]'}
                </button>
                <button className="faint" onClick={onToggle}>
                  unpublish
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="hint">publish a read-only page anyone can visit.</div>
              <button onClick={onToggle}>
                {meta.published ? '[ unpublish ]' : '[ publish ]'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* side panel                                                          */
/* ------------------------------------------------------------------ */

let commandResultBus: {
  set?: (r: { instruction: string; range: { from: number; to: number } | null; text: string; running: boolean } | null) => void
} = {}

function SidePanel({
  panel,
  setPanel,
  editor,
  docId,
  onTitle,
}: {
  panel: Exclude<Panel, null>
  setPanel: (p: Panel) => void
  editor: TiptapEditor
  docId: string
  onTitle: (t: string) => void
}) {
  return (
    <div className="panel">
      <div className="panel-tabs">
        {(['ai', 'checks', 'titles', 'comments', 'versions'] as const).map((p) => (
          <button key={p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>
            {p === 'ai' ? 'ask' : p}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setPanel(null)}>✗</button>
      </div>
      <div className="panel-body">
        {panel === 'ai' && <AskPanel editor={editor} />}
        {panel === 'checks' && <ChecksPanel editor={editor} />}
        {panel === 'titles' && <TitlesPanel editor={editor} onTitle={onTitle} />}
        {panel === 'comments' && <CommentsPanel editor={editor} docId={docId} />}
        {panel === 'versions' && <VersionsPanel editor={editor} docId={docId} />}
      </div>
    </div>
  )
}

function AskPanel({ editor }: { editor: TiptapEditor }) {
  const [question, setQuestion] = useState('')
  const [out, setOut] = useState('')
  const [running, setRunning] = useState(false)
  const [cmd, setCmd] = useState<{
    instruction: string
    range: { from: number; to: number } | null
    text: string
    running: boolean
  } | null>(null)

  useEffect(() => {
    commandResultBus.set = setCmd
    return () => {
      if (commandResultBus.set === setCmd) commandResultBus.set = undefined
    }
  }, [])

  async function run() {
    if (running) return
    setOut('')
    setRunning(true)
    try {
      await apiStream(
        '/api/ai/feedback',
        { text: docText(editor), question },
        (chunk) => setOut((o) => o + chunk)
      )
    } catch (e: any) {
      setOut((o) => o + `\n✗ ${e.message}`)
    } finally {
      setRunning(false)
    }
  }

  function applyCmd(mode: 'replace' | 'insert') {
    if (!cmd) return
    const html = textToHtml(cmd.text.trim())
    if (mode === 'replace' && cmd.range && cmd.range.to > cmd.range.from) {
      editor
        .chain()
        .focus()
        .deleteRange(cmd.range)
        .insertContentAt(cmd.range.from, html)
        .run()
    } else {
      const end = cmd.range ? cmd.range.to : editor.state.doc.content.size
      editor.chain().focus().insertContentAt(end, html).run()
    }
    setCmd(null)
  }

  return (
    <div>
      {cmd && (
        <div style={{ marginBottom: 24 }}>
          <div className="hint">
            ⌘K → <i>{cmd.instruction}</i>
            {cmd.running ? ' …' : ''}
          </div>
          <div className="ai-out">{cmd.text || '…'}</div>
          {!cmd.running && (
            <div className="ai-actions">
              {cmd.range && cmd.range.to > cmd.range.from && (
                <button onClick={() => applyCmd('replace')}>[ replace selection ]</button>
              )}
              <button onClick={() => applyCmd('insert')}>[ insert ]</button>
              <button className="faint" onClick={() => setCmd(null)}>
                discard
              </button>
            </div>
          )}
          <div className="ascii-rule" style={{ marginTop: 18 }}>
            · · · · · · · · · · · · · · · ·
          </div>
        </div>
      )}
      <div className="hint" style={{ marginBottom: 8 }}>
        ask for feedback on the draft — or ask a question about it. tip: ⌘K in the
        text runs rewrite commands.
      </div>
      <textarea
        className="ask-box"
        placeholder="optional question, e.g. “does the opening land?”"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <div className="ai-actions">
        <button onClick={run} disabled={running}>
          {running ? 'reading…' : '[ read my draft ]'}
        </button>
      </div>
      {out && <div className="ai-out">{out}</div>}
    </div>
  )
}

function ChecksPanel({ editor }: { editor: TiptapEditor }) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')

  async function run() {
    setRunning(true)
    setErr('')
    setIssues(null)
    try {
      const res = await api('/api/ai/checks', {
        method: 'POST',
        body: JSON.stringify({ text: docText(editor) }),
      })
      setIssues(res.issues || [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 8 }}>
        spelling · grammar · repetition · clichés · clarity
      </div>
      <button onClick={run} disabled={running}>
        {running ? 'checking…' : '[ run checks ]'}
      </button>
      {err && <div className="err">✗ {err}</div>}
      {issues && issues.length === 0 && (
        <div className="hint" style={{ marginTop: 16 }}>
          ✓ clean — nothing to flag
        </div>
      )}
      {issues?.map((iss, i) => (
        <div className="issue" key={i}>
          <span className="kind">[{iss.kind}]</span>
          <span
            className="excerpt"
            onClick={() => {
              const r = findRange(editor, iss.excerpt)
              if (r) selectRange(editor, r)
            }}
          >
            “{iss.excerpt}”
          </span>
          <div>{iss.note}</div>
          <div className="fix">→ {iss.suggestion}</div>
        </div>
      ))}
    </div>
  )
}

function TitlesPanel({ editor, onTitle }: { editor: TiptapEditor; onTitle: (t: string) => void }) {
  const [titles, setTitles] = useState<string[] | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')

  async function run() {
    setRunning(true)
    setErr('')
    try {
      const res = await api('/api/ai/titles', {
        method: 'POST',
        body: JSON.stringify({ text: docText(editor) }),
      })
      setTitles(res.titles || [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 8 }}>
        one click, eight titles. click one to take it.
      </div>
      <button onClick={run} disabled={running}>
        {running ? 'thinking…' : '[ suggest titles ]'}
      </button>
      {err && <div className="err">✗ {err}</div>}
      {titles?.map((t, i) => (
        <div className="title-idea" key={i} onClick={() => onTitle(t)}>
          {i + 1}. {t}
        </div>
      ))}
    </div>
  )
}

function CommentsPanel({ editor, docId }: { editor: TiptapEditor; docId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState<{ from: number; to: number; quote: string } | null>(null)
  const [text, setText] = useState('')

  async function load() {
    setComments(await api(`/api/docs/${docId}/comments`))
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [docId])

  function startDraft() {
    const { from, to } = editor.state.selection
    if (to <= from) {
      alert('select some text to comment on first')
      return
    }
    setDraft({ from, to, quote: editor.state.doc.textBetween(from, to, ' ') })
  }

  async function submit() {
    if (!draft || !text.trim()) return
    const cid = 'c_' + Math.random().toString(36).slice(2, 12)
    await api(`/api/docs/${docId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ id: cid, text, quote: draft.quote }),
    })
    editor.chain().setTextSelection(draft).setComment(cid).setTextSelection(draft.to).run()
    setDraft(null)
    setText('')
    load()
  }

  async function resolve(cid: string) {
    await api(`/api/comments/${cid}/resolve`, { method: 'POST' })
    removeCommentMark(editor, cid)
    load()
  }

  const open = comments.filter((c) => !c.resolved)
  const resolved = comments.filter((c) => c.resolved)

  return (
    <div>
      {!draft && (
        <button onClick={startDraft}>[ comment on selection ]</button>
      )}
      {draft && (
        <div style={{ marginBottom: 16 }}>
          <div className="comment-card" style={{ borderBottom: 'none', padding: 0 }}>
            <div className="quote">“{draft.quote.slice(0, 120)}”</div>
          </div>
          <textarea
            className="ask-box"
            autoFocus
            placeholder="say the thing…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="ai-actions">
            <button onClick={submit}>[ post ]</button>
            <button className="faint" onClick={() => setDraft(null)}>
              never mind
            </button>
          </div>
        </div>
      )}
      {open.length === 0 && !draft && (
        <div className="hint" style={{ marginTop: 16 }}>
          ( no open comments )
        </div>
      )}
      {open.map((c) => (
        <div className="comment-card" key={c.id}>
          <div className="byline">
            <span style={{ color: colorFor(c.username) }}>{c.username}</span>
          </div>
          {c.quote && (
            <div
              className="quote"
              onClick={() => {
                let range: { from: number; to: number } | null = null
                editor.state.doc.descendants((node, pos) => {
                  if (range) return
                  const m = node.marks.find(
                    (mk) => mk.type.name === 'comment' && mk.attrs.id === c.id
                  )
                  if (m) range = { from: pos, to: pos + node.nodeSize }
                })
                if (!range) range = findRange(editor, c.quote)
                if (range) selectRange(editor, range)
              }}
            >
              “{c.quote.slice(0, 120)}”
            </div>
          )}
          <div>{c.text}</div>
          <div className="row-actions">
            <button className="faint" onClick={() => resolve(c.id)}>
              ✓ resolve
            </button>
          </div>
        </div>
      ))}
      {resolved.length > 0 && (
        <>
          <div className="hint" style={{ marginTop: 20 }}>
            resolved —
          </div>
          {resolved.map((c) => (
            <div className="comment-card resolved" key={c.id}>
              <div className="byline">{c.username}</div>
              <div>{c.text}</div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function VersionsPanel({ editor, docId }: { editor: TiptapEditor; docId: string }) {
  const [versions, setVersions] = useState<Version[]>([])
  const [name, setName] = useState('')

  async function load() {
    setVersions(await api(`/api/docs/${docId}/versions`))
  }
  useEffect(() => {
    load()
  }, [docId])

  async function save() {
    await api(`/api/docs/${docId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ name, content: editor.getJSON() }),
    })
    setName('')
    load()
  }

  async function restore(vid: string) {
    if (!confirm('Restore this version? Current text is replaced (save a version first if unsure).'))
      return
    const v = await api(`/api/versions/${vid}`)
    editor.commands.setContent(v.content)
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 8 }}>
        try a different way of saying it without losing what you've got.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          style={{ flex: 1, borderBottom: '1px solid var(--fainter)' }}
          placeholder="name this version…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={save}>[ save ]</button>
      </div>
      {versions.length === 0 && (
        <div className="hint" style={{ marginTop: 16 }}>
          ( no versions yet )
        </div>
      )}
      {versions.map((v) => (
        <div className="version-row" key={v.id}>
          <div>{v.name}</div>
          <div className="v-meta">
            {v.username} · {new Date(v.created_at).toLocaleString()}
          </div>
          <div className="row-actions">
            <button onClick={() => restore(v.id)}>↺ restore</button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ⌘K command bar                                                      */
/* ------------------------------------------------------------------ */

const PRESETS = [
  'improve this',
  'make it shorter',
  'expand on this',
  'fix grammar & spelling',
  'make it warmer',
  'continue writing',
]

function CommandBar({
  editor,
  setPanel,
}: {
  editor: TiptapEditor
  setPanel: (p: Panel) => void
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const selRef = useRef<{ from: number; to: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const { from, to } = editor.state.selection
        selRef.current = { from, to }
        setInstruction('')
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  async function run(inst: string) {
    if (!inst.trim()) return
    setOpen(false)
    setPanel('ai')
    const range = selRef.current
    const hasSel = !!(range && range.to > range.from)
    const selection = hasSel
      ? editor.state.doc.textBetween(range!.from, range!.to, '\n\n')
      : ''
    // wait a tick for the panel to mount and register the bus
    await new Promise((r) => setTimeout(r, 50))
    const update = (partial: Partial<{ text: string; running: boolean }>) => {
      commandResultBus.set?.({
        instruction: inst,
        range: hasSel ? range : null,
        text: current.text,
        running: current.running,
        ...partial,
      } as any)
    }
    const current = { text: '', running: true }
    update({})
    try {
      await apiStream(
        '/api/ai/command',
        { instruction: inst, selection, context: docText(editor) },
        (chunk) => {
          current.text += chunk
          update({ text: current.text })
        }
      )
    } catch (e: any) {
      current.text += `\n✗ ${e.message}`
    } finally {
      current.running = false
      update({ text: current.text, running: false })
    }
  }

  if (!open) return null
  const hasSel = !!(selRef.current && selRef.current.to > selRef.current.from)

  return (
    <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-head">
          {hasSel ? '⌘K · acting on your selection' : '⌘K · acting at the end of the draft'}
        </div>
        <input
          autoFocus
          placeholder="tell the pen what to do…"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(instruction)
          }}
        />
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => run(p)}>
              [{p}]
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

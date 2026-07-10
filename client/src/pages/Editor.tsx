import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEditor, EditorContent, BubbleMenu, Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TiptapLink from '@tiptap/extension-link'
import TiptapImage from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import type { EditorView } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { api, apiStream, me, username, colorFor, localDay } from '../api'
import { CommentMark } from '../comment-mark'
import { Embed } from '../embed-node'
import { parseEmbed } from '../embeds'
import { renderMarkdown } from '../markdown'
import { uncodeBlocks } from '../uncode'
import { track } from '../analytics'
import AccountModal from '../AccountModal'
import MembershipModal from '../MembershipModal'
import Scribble from '../Scribble'
import { Checkmarks, setMarks, clearMarks, MarkItem } from '../checkmarks'
import { CoWritten, coWrittenKey } from '../co-written'
import { CommentGutter } from '../comment-gutter'
import { findRange, findWholeRange, commentRange } from '../ranges'
import { isOwnInk, PLUMBING } from '../own-ink'
import { defaultPasteKeeps } from '../paste'
import {
  type CommandResult,
  listenCommandResults,
  publishCommandResult,
} from '../command-bus'
import { keepThenRestore } from '../restore'

function needsAccount(e: unknown) {
  return (e as any)?.code === 'account_required'
}
function needsMembership(e: unknown) {
  return (e as any)?.code === 'membership_required'
}
function promptMembership() {
  window.dispatchEvent(new CustomEvent('author:membership-required'))
}

async function compressImage(f: File): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(f)
    const scale = Math.min(1, 2000 / bmp.width)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fdfcf9' // transparent pngs land on paper, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88))
  } catch {
    return null
  }
}
// keep small gifs animated; everything else gets resized + recompressed
// in the browser so heic photos and 20mb screenshots both just work
const NATIVE_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
async function prepareImage(f: File): Promise<{ body: Blob; type: string } | null> {
  let body: Blob = f
  let type = f.type
  if (!(type === 'image/gif' && f.size < 6_000_000)) {
    if (!NATIVE_IMG.includes(type) || f.size > 2_500_000) {
      const squeezed = await compressImage(f)
      if (squeezed) {
        body = squeezed
        type = 'image/jpeg'
      } else if (!NATIVE_IMG.includes(type)) {
        alert('couldn’t read that image — jpeg, png, webp, or gif work best')
        return null
      }
    }
  }
  return { body, type }
}

function promptAccount() {
  window.dispatchEvent(new CustomEvent('author:account-required'))
}

type Meta = {
  id: string
  title: string
  published: boolean
  slug: string | null
  mine: boolean
  owner: string
  header_image?: string | null
  on_profile?: boolean
}
type Comment = {
  id: string
  username: string
  quote: string
  text: string
  suggestion?: string
  parent_id?: string
  resolved: boolean
  created_at: number
}
// the one definition of a visible thread root — badge, tab, panel, and
// gutter sweeps all lean on it
const isRoot = (c: Comment) => !c.parent_id
const isOpenRoot = (c: Comment) => !c.resolved && isRoot(c)

type Issue = { excerpt: string; kind: string; note: string; suggestion: string }
type Version = { id: string; name: string; username: string; created_at: number; kind: string }
type Panel = 'ai' | 'checks' | 'comments' | 'versions' | null

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
  const penName = username() || 'someone'
  const isGhost = !!me()?.anon
  const [modalReason, setModalReason] = useState<string | null>(null)
  const [memberModal, setMemberModal] = useState(false)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [title, setTitle] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  // remembered so the single [ editor ] button reopens where you left off
  const [lastTab, setLastTab] = useState<Exclude<Panel, null>>('ai')
  const [shareOpen, setShareOpen] = useState(false)
  const [gone, setGone] = useState(false)
  const [headerUrl, setHeaderUrl] = useState<string | null>(null)
  const [others, setOthers] = useState<{ name: string; color: string }[]>([])
  const [connected, setConnected] = useState(false)
  // comments are first-class: the editor owns the list so the margin, the
  // top-bar count, the popovers, and the panel all read the same state
  const [comments, setComments] = useState<Comment[]>([])
  // y is the clicked line's bottom, yTop its top — cards hang below the
  // line, or flip above it when the viewport runs out
  const [composer, setComposer] = useState<{
    from: number
    to: number
    quote: string
    x: number
    y: number
    yTop: number
  } | null>(null)
  const [openPop, setOpenPop] = useState<{ id: string; x: number; y: number; yTop: number } | null>(
    null
  )
  // the card lit up in the sidebar — set by clicking a passage in the text
  const [focusId, setFocusId] = useState<string | null>(null)

  const ydoc = useMemo(() => new Y.Doc(), [id])
  const provider = useMemo(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    // auth rides on the session cookie, sent automatically on the handshake
    return new WebsocketProvider(`${proto}//${location.host}/ws`, id, ydoc)
  }, [id, ydoc])

  // paste or drop an image anywhere in the page: it uploads alongside the
  // header images and lands at the caret (or the drop point) as a block
  async function insertInlineImage(view: EditorView, file: File, pos?: number | null) {
    const prepped = await prepareImage(file)
    if (!prepped) return
    const res = await fetch(`/api/docs/${id}/images`, {
      method: 'POST',
      headers: { 'Content-Type': prepped.type },
      body: prepped.body,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert((err as any).error || 'upload failed — try a smaller image')
      return
    }
    const { url } = await res.json()
    // the upload took a round-trip; the editor may be gone (navigated away)
    // or the doc may have shrunk under a collaborator's edits
    if (view.isDestroyed) return
    track('doc: inline image added')
    const node = view.state.schema.nodes.image.create({ src: url })
    const end = view.state.doc.content.size
    const at = pos != null ? Math.min(pos, end) : null
    try {
      const tr =
        at != null ? view.state.tr.insert(at, node) : view.state.tr.replaceSelectionWith(node)
      view.dispatch(tr)
    } catch {
      // pos landed inside a node boundary after concurrent edits — fall back
      // to the current selection rather than throwing the image away
      view.dispatch(view.state.tr.replaceSelectionWith(node))
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: penName, color: colorFor(penName) },
      }),
      Placeholder.configure({ placeholder: 'begin…' }),
      CharacterCount,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      // only recognize our own uploads — a pasted external/data: <img> is
      // dropped on the way in, so the editor never shows an image the
      // published page (which strips non-/files srcs) would silently lose
      TiptapImage.extend({
        parseHTML() {
          return [{ tag: 'img[src^="/files/"]' }]
        },
      }),
      Underline,
      CommentMark,
      Embed,
      Checkmarks,
      CoWritten,
      CommentGutter,
    ],
    editorProps: {
      handlePaste: (view, event) => {
        const cd = event.clipboardData
        // a bare provider URL on its own line becomes a player
        const text = cd?.getData('text/plain')?.trim() ?? ''
        if (text && !/\s/.test(text)) {
          const embed = parseEmbed(text)
          if (embed) {
            const node = view.state.schema.nodes.embed.create(embed)
            view.dispatch(view.state.tr.replaceSelectionWith(node))
            track('doc: embed added', { provider: embed.provider })
            return true
          }
        }
        // rich content (Word, web pages) ships an image rendition *alongside*
        // the real text — let the default paste win when it would keep
        // anything. but "copy image" ships only an external <img> the schema
        // drops: there the file on the clipboard is the whole paste
        const file = Array.from(cd?.files ?? []).find((f) => f.type.startsWith('image/'))
        if (file && !defaultPasteKeeps(cd?.getData('text/html') ?? '', text)) {
          insertInlineImage(view, file)
          return true
        }
        return false
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false // reordering content within the doc, not a file
        const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
          f.type.startsWith('image/')
        )
        if (!file) return false
        const drop = view.posAtCoords({ left: event.clientX, top: event.clientY })
        insertInlineImage(view, file, drop?.pos)
        return true
      },
    },
  })

  // lifecycle: meta, presence, teardown
  useEffect(() => {
    api(`/api/docs/${id}/open`, { method: 'POST' })
      .then((m: Meta) => {
        setMeta(m)
        const metaMap = ydoc.getMap('meta')
        const applyMeta = () => {
          setTitle((metaMap.get('title') as string) ?? '')
          setHeaderUrl((metaMap.get('header') as string) ?? null)
        }
        metaMap.observe(applyMeta)
        let seeded = false // sync fires on every reconnect; seed only once
        provider.on('sync', (synced: boolean) => {
          setConnected(synced)
          if (!synced || seeded) return
          seeded = true
          if (metaMap.get('title') === undefined && m.title && m.title !== 'untitled') {
            metaMap.set('title', m.title)
          }
          // the server column is authoritative for the header image
          if (m.header_image && metaMap.get('header') !== m.header_image) {
            metaMap.set('header', m.header_image)
          }
        })
        applyMeta()
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
    const push = ({ transaction }: { transaction: Transaction }) => {
      // a collaborator's typing fires 'update' here too — but the snapshot
      // POST credits *this* viewer's activity chart, so only their own pen
      // may send it. the writer's own tab keeps the html column fresh.
      if (!isOwnInk(transaction)) return
      clearTimeout(htmlTimer.current)
      htmlTimer.current = setTimeout(() => {
        api(`/api/docs/${id}/html`, {
          method: 'POST',
          body: JSON.stringify({ html: editor.getHTML(), day: localDay() }),
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

  async function uploadHeader(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const prepped = await prepareImage(f)
    if (!prepped) return
    const res = await fetch(`/api/docs/${id}/header`, {
      method: 'POST',
      headers: { 'Content-Type': prepped.type },
      body: prepped.body,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert((err as any).error || 'upload failed — try a smaller image')
      return
    }
    const { url } = await res.json()
    track('doc: header image set')
    ydoc.getMap('meta').set('header', url)
  }

  async function removeHeader() {
    track('doc: header image removed')
    await api(`/api/docs/${id}/header`, { method: 'DELETE' }).catch(() => {})
    ydoc.getMap('meta').delete('header')
  }

  // ---------- publish ----------
  async function togglePublish() {
    if (!editor || !meta) return
    try {
      const res = await api(`/api/docs/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ publish: !meta.published, html: editor.getHTML() }),
      })
      track(res.published ? 'doc: published' : 'doc: unpublished')
      setMeta({ ...meta, published: res.published, slug: res.slug })
    } catch (e: any) {
      if (e?.code === 'account_required') {
        setShareOpen(false)
        track('account prompt: shown', { reason: 'publish' })
        setModalReason('publishing needs a desk — take one and this page comes with you')
        return
      }
      throw e
    }
  }

  async function toggleOnProfile() {
    if (!meta) return
    const res = await api(`/api/docs/${id}/profile`, {
      method: 'POST',
      body: JSON.stringify({ show: !meta.on_profile }),
    })
    track('doc: profile listing toggled', { on: res.on_profile })
    setMeta({ ...meta, on_profile: res.on_profile })
  }

  // ghosts get exactly one nudge: on account-required errors, and once if
  // they try to leave with unsaved writing
  useEffect(() => {
    const onNeed = () => {
      track('account prompt: shown', { reason: 'ai limit' })
      setModalReason('that one was on the house — take a desk for more')
    }
    window.addEventListener('author:account-required', onNeed)
    const onMember = () => {
      track('membership prompt: shown')
      setMemberModal(true)
    }
    window.addEventListener('author:membership-required', onMember)
    return () => {
      window.removeEventListener('author:account-required', onNeed)
      window.removeEventListener('author:membership-required', onMember)
    }
  }, [])

  // the leave handler reads meta through a ref so publish/profile toggles
  // don't rebuild the listener (or cancel a pitch already ticking)
  const metaRef = useRef(meta)
  useEffect(() => {
    metaRef.current = meta
  }, [meta])
  useEffect(() => {
    if (!isGhost || !editor) return
    let stayTimer: ReturnType<typeof setTimeout>
    const h = (e: BeforeUnloadEvent) => {
      if (localStorage.getItem('author.ghost-nagged')) return
      if (editor.isDestroyed || editor.storage.characterCount.words() === 0) return
      localStorage.setItem('author.ghost-nagged', '1')
      e.preventDefault()
      e.returnValue = ''
      // a custom modal can't interrupt an unload — but if they choose to
      // stay, the tab survives and we can make the pitch properly. if they
      // leave anyway, this timer dies with the page.
      stayTimer = setTimeout(() => {
        const m = metaRef.current
        track('account prompt: shown', { reason: 'before leaving' })
        setModalReason(
          m && !m.mine
            ? 'before you drift off — save this page to your desk?'
            : 'before you drift off — this page only exists in this tab'
        )
      }, 400)
    }
    window.addEventListener('beforeunload', h)
    return () => {
      clearTimeout(stayTimer)
      window.removeEventListener('beforeunload', h)
    }
  }, [isGhost, editor])

  // ---------- comments ----------
  const lastCommentsJson = useRef('')
  async function reloadComments() {
    try {
      const next = await api(`/api/docs/${id}/comments`)
      const s = JSON.stringify(next)
      // most ticks change nothing — don't re-render the whole editor for them
      if (s !== lastCommentsJson.current) {
        lastCommentsJson.current = s
        setComments(next)
      }
    } catch {
      /* transient — the poll will retry */
    }
  }
  useEffect(() => {
    reloadComments()
    // a backgrounded tab doesn't need fresh comments
    const t = setInterval(() => {
      if (!document.hidden) reloadComments()
    }, 4000)
    const onChanged = () => reloadComments()
    window.addEventListener('author:comments-changed', onChanged)
    return () => {
      clearInterval(t)
      window.removeEventListener('author:comments-changed', onChanged)
    }
  }, [id])

  function openComposer() {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (to <= from) {
      // silence here read as "the button is broken" — say what's missing
      alert('select some text to comment on first')
      return
    }
    const quote = editor.state.doc.textBetween(from, to, ' ')
    // a stale selection can sit outside the viewport — the card must never
    // open where the writer can't see it (its backdrop would eat the page)
    let coords = editor.view.coordsAtPos(to)
    if (coords.bottom < 0 || coords.top > window.innerHeight) {
      editor.chain().focus().scrollIntoView().run()
      coords = editor.view.coordsAtPos(to)
    }
    setOpenPop(null)
    setComposer({ from, to, quote, x: coords.left, y: coords.bottom, yTop: coords.top })
  }

  useEffect(() => {
    if (!editor) return
    // the shortcut itself (⌥⌘M / ctrl+alt+M) lives in the CommentMark
    // extension, editor-scoped; the bubble and panel dispatch this event
    const onOpen = () => openComposer()
    // the margin glyph names the comment it points at — light that card up
    const onOpenPanel = (e: Event) => {
      openPanel('comments')
      const cid = (e as CustomEvent).detail?.id
      if (cid) setFocusId(cid)
    }
    window.addEventListener('author:comment', onOpen)
    window.addEventListener('author:open-comments', onOpenPanel)
    return () => {
      window.removeEventListener('author:comment', onOpen)
      window.removeEventListener('author:open-comments', onOpenPanel)
    }
  }, [editor])

  // marks belong to open threads: when the poll says a comment settled,
  // sweep its mark out of the shared doc (idempotent — any client may do it)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const settled = new Set(comments.filter((c) => c.resolved).map((c) => c.id))
    if (settled.size === 0) return
    const { doc, schema } = editor.state
    const tr = editor.state.tr
    doc.descendants((node, pos) => {
      node.marks.forEach((m) => {
        if (m.type.name === 'comment' && settled.has(m.attrs.id)) {
          tr.removeMark(pos, pos + node.nodeSize, schema.marks.comment)
        }
      })
    })
    // the sweep is bookkeeping, not writing — it must not read as this
    // viewer's ink
    if (tr.steps.length) editor.view.dispatch(tr.setMeta(PLUMBING, true))
  }, [comments, editor])

  // the "written twice" note needs to know whether anyone else is here
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(coWrittenKey, { others: others.length }))
    }
  }, [others, editor])

  const openComments = comments.filter(isOpenRoot)
  // the pop can outlive a click on a mark whose body hasn't polled in yet —
  // it renders the moment the comment arrives
  const popComment = openPop ? (comments.find((c) => c.id === openPop.id) ?? null) : null

  const words = editor ? editor.storage.characterCount.words() : 0

  // reopening returns to the last tab; versions still needs a desk
  useEffect(() => {
    if (panel) setLastTab(panel)
  }, [panel])
  function openPanel(p: Panel) {
    if (p === 'versions' && isGhost) {
      track('account prompt: shown', { reason: 'versions' })
      setModalReason('versions keep what you had — that needs a desk')
      return
    }
    setPanel(p)
  }

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
        {isGhost ? <span className="faint">✎ a ghost draft</span> : <Link to="/">← desk</Link>}
        <span className="faint">{connected ? '●' : '○'}</span>
        <div className="presence">
          <span className="who" style={{ color: colorFor(penName) }}>
            {penName}
          </span>
          {others.map((o, i) => (
            <span className="who" key={i} style={{ color: o.color }}>
              + {o.name}
            </span>
          ))}
        </div>
        <div className="spacer" />
        <span className="faint">{words} words</span>
        {openComments.length > 0 && (
          <button
            className={panel === 'comments' ? 'on comment-count' : 'comment-count'}
            onClick={() => (panel === 'comments' ? setPanel(null) : openPanel('comments'))}
            title="open comments"
          >
            ☞ {openComments.length}
          </button>
        )}
        <button
          className={panel ? 'on' : ''}
          onClick={() => (panel ? setPanel(null) : openPanel(lastTab))}
          title="ask, proof, comments, versions"
        >
          [ editor ]
        </button>
        {isGhost && (
          <button
            className="accent"
            onClick={() => {
              track('account prompt: shown', { reason: 'save to desk' })
              setModalReason(
                meta && !meta.mine
                  ? 'save this page to your desk — your notes come with you'
                  : 'keep this page — it only exists in this tab for now'
              )
            }}
          >
            [ save to a desk ]
          </button>
        )}
        <div className="share-anchor">
          <button
            className={shareOpen || meta?.published ? 'on' : ''}
            onClick={() => meta && setShareOpen(!shareOpen)}
          >
            {meta?.published ? '✽ share' : '[ share ]'}
          </button>
          {shareOpen && meta && (
            <SharePop
              meta={meta}
              onToggle={togglePublish}
              onProfileToggle={toggleOnProfile}
              onClose={() => setShareOpen(false)}
            />
          )}
        </div>
      </div>
      <div className="ed-body">
        <div
          className="ed-scroll"
          onMouseDown={(e) => {
            // clicking anywhere in the empty page focuses the pen (Notion-style)
            const t = e.target as HTMLElement
            if (t.classList.contains('ed-scroll') || t.classList.contains('ed-page')) {
              e.preventDefault()
              editor?.chain().focus('end').run()
            }
          }}
          onClick={(e) => {
            // clicking a commented passage floats its thread right there —
            // but a drag-select ending inside the mark is editing, not reading
            if (editor && !editor.state.selection.empty) return
            const mark = (e.target as HTMLElement).closest?.(
              'span.comment-mark'
            ) as HTMLElement | null
            const cid = mark?.dataset.commentId
            if (!cid || !editor) {
              setFocusId(null)
              return
            }
            setComposer(null)
            setFocusId(cid)
            if (panel === 'comments') {
              // the sidebar is the full view — light its card up instead of
              // floating a second copy over the text
              setOpenPop(null)
            } else {
              // hang the card below the clicked line, never over it
              const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
              const c = pos ? editor.view.coordsAtPos(pos.pos) : null
              setOpenPop({
                id: cid,
                x: e.clientX,
                y: c ? c.bottom : e.clientY,
                yTop: c ? c.top : e.clientY,
              })
            }
            // a mark can arrive over yjs before its body arrives over http
            if (!comments.some((c) => c.id === cid)) reloadComments()
          }}
        >
          <div className="ed-page">
            {headerUrl ? (
              <div className="header-wrap">
                <img className="header-img" src={headerUrl} alt="" />
                <div className="header-controls">
                  <label className="file-pick">
                    [ change ]
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={uploadHeader}
                    />
                  </label>
                  <button onClick={removeHeader}>[ remove ]</button>
                </div>
              </div>
            ) : (
              <label className="header-add">
                [ + header image ]
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={uploadHeader}
                />
              </label>
            )}
            <input
              className="title-input"
              placeholder="untitled"
              value={title}
              onChange={(e) => updateTitle(e.target.value)}
              onKeyDown={(e) => {
                // enter drops you into the page, same as tab
                if (e.key === 'Enter') {
                  e.preventDefault()
                  editor?.chain().focus('start').run()
                }
              }}
            />
            <div className="ascii-rule">~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~</div>
            <EditorContent editor={editor} />
            {editor && <FormatBubble editor={editor} />}
          </div>
        </div>
        {panel && editor && (
          <SidePanel
            panel={panel}
            setPanel={openPanel}
            editor={editor}
            docId={id}
            comments={comments}
            reloadComments={reloadComments}
            focusId={focusId}
          />
        )}
      </div>
      {editor && <CommandBar editor={editor} setPanel={setPanel} />}
      {composer && editor && (
        <CommentComposer
          editor={editor}
          docId={id}
          draft={composer}
          onClose={() => setComposer(null)}
          onPosted={reloadComments}
        />
      )}
      {popComment && editor && (
        <CommentPop
          editor={editor}
          docId={id}
          comment={popComment}
          replies={comments.filter((c) => c.parent_id === popComment.id)}
          at={openPop!}
          onClose={() => setOpenPop(null)}
          onChanged={reloadComments}
        />
      )}
      {modalReason && (
        <AccountModal reason={modalReason} onClose={() => setModalReason(null)} />
      )}
      {memberModal && <MembershipModal onClose={() => setMemberModal(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* formatting bubble (appears over selected text)                      */
/* ------------------------------------------------------------------ */

function FormatBubble({ editor }: { editor: TiptapEditor }) {
  function setLink() {
    const existing = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('link to…', existing || 'https://')
    if (url === null) return
    if (!url.trim() || url.trim() === 'https://') {
      editor.chain().focus().unsetLink().run()
      return
    }
    const href = /^https?:\/\//i.test(url) ? url.trim() : 'https://' + url.trim()
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  const item = (
    label: ReactNode,
    active: boolean,
    run: () => void,
    name: string,
    title?: string
  ) => (
    <button
      className={active ? 'on' : ''}
      title={title || name}
      aria-label={name}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault() // keep the selection
        run()
      }}
    >
      {label}
    </button>
  )

  return (
    <BubbleMenu editor={editor} tippyOptions={{ duration: 120, maxWidth: 'none' }}>
      <div className="fmt-bubble" role="toolbar" aria-label="formatting">
        {item(<b>b</b>, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'bold', 'bold ⌘B')}
        {item(<i>i</i>, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'italic', 'italic ⌘I')}
        {item(<u>u</u>, editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), 'underline', 'underline ⌘U')}
        {item(<s>s</s>, editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'strikethrough', 'strikethrough ⌘⇧X')}
        {item(<code>code</code>, editor.isActive('code') || editor.isActive('codeBlock'), () => {
          // a pasted <pre> traps whole pages in a code block; clicking code
          // inside one dissolves it back to prose instead of toggling a mark
          // the block's schema would swallow silently
          const dissolved = editor.chain().focus().command(({ state, tr }) => uncodeBlocks(state, tr)).run()
          if (!dissolved) editor.chain().focus().toggleCode().run()
        }, 'code')}
        <span className="fmt-sep">·</span>
        {item('h1', editor.isActive('heading', { level: 1 }), () =>
          editor.chain().focus().toggleHeading({ level: 1 }).run(),
          'big heading'
        )}
        {item('h2', editor.isActive('heading', { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
          'small heading'
        )}
        {item('“quote”', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'quote')}
        <span className="fmt-sep">·</span>
        {item('link', editor.isActive('link'), setLink, 'link', 'add or edit link')}
        {item('☞ comment', editor.isActive('comment'), () => window.dispatchEvent(new CustomEvent('author:comment')), 'comment', 'comment ⌥⌘M')}
        {item('✎ ai', false, () => window.dispatchEvent(new CustomEvent('author:open-cmdk')), 'ai', 'rewrite with ⌘K')}
      </div>
    </BubbleMenu>
  )
}

/* ------------------------------------------------------------------ */
/* share popover                                                       */
/* ------------------------------------------------------------------ */

function SharePop({
  meta,
  onToggle,
  onProfileToggle,
  onClose,
}: {
  meta: Meta
  onToggle: () => void
  onProfileToggle: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'write' | 'read' | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  const writeUrl = `${location.origin}/d/${meta.id}`
  const readUrl = meta.slug ? `${location.origin}/p/${meta.slug}` : null

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  function copy(url: string, which: 'write' | 'read') {
    track('share: link copied', { kind: which === 'write' ? 'writing' : 'reading' })
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
            send this link to people you want to be able to edit and comment
            on your writing.
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
              {meta.mine && (
                <div style={{ marginTop: 10 }}>
                  <button onClick={onProfileToggle}>
                    {meta.on_profile ? '[✓]' : '[ ]'} listed on your profile
                  </button>
                  <div className="hint">
                    when on, this page appears under your public profile’s writing.
                  </div>
                </div>
              )}
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

// the one way to run the pen: stream a rewrite into the ask panel, where
// [replace]/[insert] live.
async function runAiCommand(
  editor: TiptapEditor,
  setPanel: (p: Panel) => void,
  inst: string,
  range: { from: number; to: number } | null
) {
  setPanel('ai')
  const hasSel = !!(range && range.to > range.from)
  const selection = hasSel ? editor.state.doc.textBetween(range!.from, range!.to, '\n\n') : ''
  if (hasSel && range) {
    setMarks(editor, 'pending', [{ from: range.from, to: range.to, cls: 'pen-hover' }])
  }
  // wait a tick for the panel to mount and register the bus
  await new Promise((r) => setTimeout(r, 50))
  const update = (partial: Partial<{ text: string; running: boolean }>) => {
    publishCommandResult(editor, {
      instruction: inst,
      range: hasSel ? range : null,
      sourceText: selection,
      text: current.text,
      running: current.running,
      ...partial,
    })
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
    if (needsAccount(e)) promptAccount()
    else if (needsMembership(e)) promptMembership()
    else current.text += `\n✗ ${e.message}`
  } finally {
    current.running = false
    update({ text: current.text, running: false })
  }
}

// a suggested edit applies itself — the reviewer already wrote the words.
// no model involved: the mark's span (or the hunted-down quote) is replaced
// with exactly what they proposed
async function applySuggestion(editor: TiptapEditor, c: Comment, onDone: () => void) {
  const r = commentRange(editor, c)
  if (!r) {
    alert('couldn’t find the passage this edit refers to — it may have been rewritten')
    return
  }
  const text = (c.suggestion || '').trim()
  track('comment: suggestion applied')
  if (/\n{2,}/.test(text)) {
    editor.chain().focus().deleteRange(r).insertContentAt(r.from, textToHtml(text)).run()
  } else {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insertText(text, r.from, r.to)
        return true
      })
      .run()
  }
  if (await resolveComment(editor, c.id, 'suggestion')) onDone()
}

async function resolveComment(editor: TiptapEditor, cid: string, via?: string) {
  try {
    await api(`/api/comments/${cid}/resolve`, { method: 'POST' })
  } catch {
    // the mark only comes off once the desk has heard — otherwise the
    // comment would resurrect on the next poll with its anchor gone
    alert('couldn’t reach the desk — the comment stays open for now')
    return false
  }
  track('comment: resolved', via ? { via } : undefined)
  removeCommentMark(editor, cid)
  return true
}

function SidePanel({
  panel,
  setPanel,
  editor,
  docId,
  comments,
  reloadComments,
  focusId,
}: {
  panel: Exclude<Panel, null>
  setPanel: (p: Panel) => void
  editor: TiptapEditor
  docId: string
  comments: Comment[]
  reloadComments: () => void
  focusId: string | null
}) {
  const openCount = comments.filter(isOpenRoot).length
  // internal keys keep their history; these are the names on the door
  const TAB_LABELS: Record<string, string> = { ai: 'ask', checks: 'proof' }
  return (
    <div className="panel">
      <div className="panel-tabs">
        {(['ai', 'checks', 'comments', 'versions'] as const).map((p) => (
          <button key={p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>
            {p === 'comments' && openCount > 0 ? `comments·${openCount}` : (TAB_LABELS[p] ?? p)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setPanel(null)}>✗</button>
      </div>
      <div className="panel-body">
        {panel === 'ai' && <AskPanel editor={editor} />}
        {panel === 'checks' && <ChecksPanel editor={editor} />}
        {panel === 'comments' && (
          <CommentsPanel
            editor={editor}
            docId={docId}
            comments={comments}
            reload={reloadComments}
            focusId={focusId}
          />
        )}
        {panel === 'versions' && <VersionsPanel editor={editor} docId={docId} />}
      </div>
    </div>
  )
}

type Turn = { role: 'user' | 'assistant'; content: string }

// memoized so a streaming turn doesn't re-parse every prior answer each chunk
const MarkdownView = memo(({ content }: { content: string }) => (
  <div className="ai-out" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
))

function AskPanel({ editor }: { editor: TiptapEditor }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [cmd, setCmd] = useState<CommandResult | null>(null)

  useEffect(() => {
    const unlisten = listenCommandResults(setCmd)
    return () => {
      unlisten()
      clearMarks(editor, 'pending')
    }
  }, [editor])

  async function send() {
    if (running) return
    const q = input.trim()
    // the first message can be blank (general feedback); replies need words
    if (turns.length > 0 && !q) return
    track('ai: feedback asked', { question: !!q, reply: turns.length > 0 })
    const prev = turns // for rollback if nothing streams back
    const thread = [...turns, { role: 'user' as const, content: q }]
    // render the user's turn immediately, plus an empty assistant turn to stream into
    setTurns([...thread, { role: 'assistant', content: '' }])
    setInput('')
    setRunning(true)
    let acc = ''
    try {
      await apiStream(
        '/api/ai/feedback',
        { text: docText(editor), turns: thread },
        (chunk) => {
          acc += chunk
          setTurns((t) => {
            const copy = t.slice()
            copy[copy.length - 1] = { role: 'assistant', content: acc }
            return copy
          })
        }
      )
    } catch (e: any) {
      if (acc) {
        // partial answer arrived — keep it and mark the interruption
        setTurns((t) => {
          const copy = t.slice()
          copy[copy.length - 1] = { role: 'assistant', content: acc + `\n\n✗ ${e.message}` }
          return copy
        })
      } else {
        // nothing streamed (e.g. a 403) — undo the optimistic turns and let the
        // writer retry, rather than stranding an empty bubble in the thread
        setTurns(prev)
        setInput(q)
      }
      if (needsAccount(e)) promptAccount()
      else if (needsMembership(e)) promptMembership()
    } finally {
      setRunning(false)
    }
  }

  function applyCmd(mode: 'replace' | 'insert') {
    if (!cmd) return
    clearMarks(editor, 'pending')
    track('ai: command applied', { mode })
    const text = cmd.text.trim()
    const docSize = editor.state.doc.content.size

    if (mode === 'replace' && cmd.range && cmd.range.to > cmd.range.from) {
      // the doc may have changed since ⌘K was pressed (typing, collaborators) —
      // trust the stored range only if it still holds the original selection,
      // otherwise search for that text and replace it where it lives now.
      let r: { from: number; to: number } | null = {
        from: Math.min(cmd.range.from, docSize),
        to: Math.min(cmd.range.to, docSize),
      }
      const current = editor.state.doc.textBetween(r.from, r.to, '\n\n')
      if (current !== cmd.sourceText) {
        r = findWholeRange(editor, cmd.sourceText)
      }
      if (!r) {
        alert('the original selection has changed — inserting at the end instead')
        editor.chain().focus().insertContentAt(docSize, textToHtml(text)).run()
        setCmd(null)
        return
      }
      if (/\n{2,}/.test(text)) {
        // multi-paragraph result: replace with block content
        editor.chain().focus().deleteRange(r).insertContentAt(r.from, textToHtml(text)).run()
      } else {
        // single-paragraph result: replace as plain text so the surrounding
        // paragraph isn't split and no characters get HTML-mangled
        const range = r
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.insertText(text, range.from, range.to)
            return true
          })
          .run()
      }
    } else {
      const end = Math.min(cmd.range ? cmd.range.to : docSize, editor.state.doc.content.size)
      editor.chain().focus().insertContentAt(end, textToHtml(text)).run()
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
          {cmd.running && !cmd.text ? (
            <Scribble phrases={['rewriting…', 'crossing out, starting again…', 'reading it back…']} />
          ) : (
            // the rewrite is plain text, not markdown — keep its line breaks
            <div className="ai-out plain">{cmd.text}</div>
          )}
          {!cmd.running && (
            <div className="ai-actions">
              {cmd.range && cmd.range.to > cmd.range.from && (
                <button onClick={() => applyCmd('replace')}>[ replace selection ]</button>
              )}
              <button onClick={() => applyCmd('insert')}>[ insert ]</button>
              <button
                className="faint"
                onClick={() => {
                  clearMarks(editor, 'pending')
                  setCmd(null)
                }}
              >
                discard
              </button>
            </div>
          )}
          <div className="ascii-rule" style={{ marginTop: 18 }}>
            · · · · · · · · · · · · · · · ·
          </div>
        </div>
      )}
      {turns.length === 0 && (
        <div className="hint" style={{ marginBottom: 8 }}>
          ask for feedback on the draft — or ask a question about it. tip: ⌘K in the
          text runs rewrite commands.
        </div>
      )}
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <div className="ask-you" key={i}>
            {t.content || <span className="faint">read my draft</span>}
          </div>
        ) : running && i === turns.length - 1 && !t.content ? (
          <Scribble
            key={i}
            phrases={['reading the whole thing…', 'sitting with it…', 'making margin notes…']}
          />
        ) : (
          <MarkdownView content={t.content} key={i} />
        )
      )}
      <textarea
        className="ask-box"
        style={{ marginTop: turns.length ? 18 : 0 }}
        placeholder={
          turns.length
            ? 'reply…'
            : 'optional question, e.g. “does the opening land?”'
        }
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter sends, like most chat boxes
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="ai-actions">
        <button onClick={send} disabled={running || (turns.length > 0 && !input.trim())}>
          {running ? 'reading…' : turns.length ? '[ reply ]' : '[ read my draft ]'}
        </button>
        {turns.length > 0 && !running && (
          <button
            className="faint"
            onClick={() => {
              setTurns([])
              setInput('')
            }}
          >
            start over
          </button>
        )}
      </div>
    </div>
  )
}

const CHECK_PHRASES = [
  'reading closely…',
  'uncapping the red pen…',
  'muttering about commas…',
  'circling the third paragraph…',
  'hunting clichés…',
  'double-checking “necessary”…',
]

function decorateIssues(editor: TiptapEditor, issues: Issue[]) {
  const items: MarkItem[] = []
  issues.forEach((iss, idx) => {
    const r = findRange(editor, iss.excerpt)
    if (r)
      items.push({
        from: r.from,
        to: r.to,
        cls: `check-mark check-${iss.kind}`,
        title: `${iss.kind} — ${iss.note}`,
        data: { 'data-issue-idx': String(idx) },
      })
  })
  setMarks(editor, 'checks', items)
}

// each check is its own errand — the writer picks what the proof reads for
// descriptions stay short enough to fit the panel on one line — the full
// definitions live server-side in the prompt
const PROOF_CHECKS = [
  { key: 'grammar', label: 'grammar', desc: 'typos, tense, agreement' },
  { key: 'clarity', label: 'clarity', desc: 'repeats, clutter, tangles' },
  { key: 'cliche', label: 'clichés', desc: 'phrases worn smooth' },
  { key: 'hedging', label: 'hedging', desc: 'maybes and hedges' },
] as const

function ChecksPanel({ editor }: { editor: TiptapEditor }) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [running, setRunning] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set(['grammar']))
  const [custom, setCustom] = useState('')
  const [customOn, setCustomOn] = useState(false)
  const [err, setErr] = useState('')
  const [active, setActive] = useState<number | null>(null)
  const [taken, setTaken] = useState<Set<number>>(new Set())

  // the pen lifts when the panel closes
  useEffect(() => () => clearMarks(editor, 'checks'), [editor])

  // clicking a marked passage scrolls its note into view and lights it up
  useEffect(() => {
    const dom = editor.view.dom
    const onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest?.('[data-issue-idx]') as HTMLElement | null
      if (!el) return
      const idx = Number(el.getAttribute('data-issue-idx'))
      if (Number.isNaN(idx)) return
      setActive(idx)
      document
        .getElementById(`check-issue-${idx}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    dom.addEventListener('click', onClick)
    return () => dom.removeEventListener('click', onClick)
  }, [editor])

  function toggle(key: string) {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  async function run() {
    if (running) return // enter in the custom field must not double-run
    const checks = PROOF_CHECKS.map((c) => c.key).filter((k) => picked.has(k))
    const ask = customOn ? custom.trim() : ''
    if (!checks.length && !ask) {
      setErr('pick at least one thing to read for')
      return
    }
    setRunning(true)
    setErr('')
    setIssues(null)
    setActive(null)
    setTaken(new Set())
    clearMarks(editor, 'checks')
    try {
      const res = await api('/api/ai/checks', {
        method: 'POST',
        body: JSON.stringify({ text: docText(editor), checks, custom: ask }),
      })
      setIssues(res.issues || [])
      decorateIssues(editor, res.issues || [])
      track('ai: checks ran', {
        checks: checks.join(','),
        custom: !!ask,
        issues: (res.issues || []).length,
      })
    } catch (e: any) {
      if (needsAccount(e)) promptAccount()
      else if (needsMembership(e)) promptMembership()
      else setErr(e.message)
    } finally {
      setRunning(false)
    }
  }

  // the fix is one click from taken — the flagged span is replaced with the
  // suggested words, exactly as written, and the mark comes off with it.
  // whole-match only: replacing a prefix would leave the tail of the old
  // sentence sitting after the fix
  function takeFix(iss: Issue, i: number) {
    const r = findWholeRange(editor, iss.excerpt)
    if (!r) {
      alert('couldn’t find that passage — it may have been rewritten')
      return
    }
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insertText(iss.suggestion, r.from, r.to)
        return true
      })
      .run()
    setTaken((s) => new Set(s).add(i))
    // redraw: positions moved, and the taken excerpt no longer exists so
    // its mark drops out on its own
    if (issues) decorateIssues(editor, issues)
    track('ai: check fix applied', { kind: iss.kind })
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 4 }}>
        a proof-read for exactly what you pick — nothing else.
      </div>
      {PROOF_CHECKS.map((c) => (
        <div className="proof-row" key={c.key}>
          <button aria-pressed={picked.has(c.key)} onClick={() => toggle(c.key)}>
            [{picked.has(c.key) ? '✓' : ' '}] {c.label}
          </button>
          <span className="desc"> — {c.desc}</span>
        </div>
      ))}
      <div className="proof-row">
        <button
          aria-pressed={customOn && !!custom.trim()}
          onClick={() => {
            // toggling the box never touches the words in it
            if (customOn) setCustomOn(false)
            else {
              setCustomOn(true)
              if (!custom.trim()) document.getElementById('proof-custom')?.focus()
            }
          }}
        >
          [{customOn && custom.trim() ? '✓' : ' '}] custom
        </button>
        <span className="desc"> — your own check</span>
      </div>
      <input
        id="proof-custom"
        className="proof-custom"
        placeholder="what should the pen read for?"
        maxLength={300}
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value)
          if (e.target.value.trim()) setCustomOn(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            run()
          }
        }}
      />
      <div>
        <button className="proof-run" onClick={run} disabled={running}>
          {running ? 'reading…' : '[ read the draft ]'}
        </button>
      </div>
      {running && <Scribble phrases={CHECK_PHRASES} />}
      {err && <div className="err">✗ {err}</div>}
      {issues && issues.length === 0 && (
        <div className="hint" style={{ marginTop: 16 }}>
          ✓ clean — nothing to flag
        </div>
      )}
      {issues?.map((iss, i) => (
        <div
          className={`issue ${active === i ? 'active' : ''} ${taken.has(i) ? 'taken' : ''}`}
          id={`check-issue-${i}`}
          key={i}
        >
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
          <div className="row-actions">
            {taken.has(i) ? (
              <span className="hint">✓ incorporated</span>
            ) : (
              <button onClick={() => takeFix(iss, i)} title="replace the passage with the fix">
                [ ✓ incorporate ]
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// one line at a time, as many as the talk takes — replying is the default
// action here; settling the thread rides along as the quiet one
function ReplyBox({
  docId,
  parentId,
  onPosted,
  children,
}: {
  docId: string
  parentId: string
  onPosted: () => void
  children?: ReactNode
}) {
  const [text, setText] = useState('')
  const box = useRef<HTMLInputElement>(null)
  async function send() {
    const t = text.trim()
    if (!t) return
    try {
      await api(`/api/docs/${docId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text: t, parent_id: parentId }),
      })
    } catch (e) {
      if (needsAccount(e)) promptAccount()
      else if (needsMembership(e)) promptMembership()
      else if ((e as Error)?.message === 'that thread is settled')
        alert('this thread settled while you were writing')
      else alert('couldn’t post that — give it another try')
      onPosted() // the list may have moved under us — refresh either way
      return
    }
    track('comment: replied')
    setText('')
    onPosted()
  }
  return (
    <>
      <input
        ref={box}
        className="reply-box"
        placeholder="write back…"
        aria-label="reply to this thread"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="row-actions">
        <button
          className="primary"
          onClick={() => (text.trim() ? send() : box.current?.focus())}
        >
          [ ↩ reply ]
        </button>
        {children}
      </div>
    </>
  )
}

function Replies({ replies }: { replies: Comment[] }) {
  if (replies.length === 0) return null
  return (
    <>
      {replies.map((r) => (
        <div className="reply" key={r.id}>
          <span className="byline" style={{ color: colorFor(r.username) }}>
            {r.username}
          </span>{' '}
          {r.text}
        </div>
      ))}
    </>
  )
}

// the floating card where a comment is written — appears at the selection,
// so leaving a note never means leaving the page
function CommentComposer({
  editor,
  docId,
  draft,
  onClose,
  onPosted,
}: {
  editor: TiptapEditor
  docId: string
  draft: { from: number; to: number; quote: string; x: number; y: number; yTop: number }
  onClose: () => void
  onPosted: () => void
}) {
  const [mode, setMode] = useState<'note' | 'edit'>('note')
  const [text, setText] = useState('')
  const [sugg, setSugg] = useState(draft.quote)

  async function post() {
    const note = text.trim()
    const suggestion = mode === 'edit' ? sugg.trim() : ''
    if (mode === 'note' ? !note : !suggestion) return
    const cid = 'c_' + Math.random().toString(36).slice(2, 12)
    try {
      await api(`/api/docs/${docId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ id: cid, text: note, suggestion, quote: draft.quote }),
      })
    } catch (e) {
      if (needsAccount(e)) promptAccount()
      else if (needsMembership(e)) promptMembership()
      // a refusal names its reason (too long, empty) — the generic shrug
      // is for the network
      else if ((e as any)?.status === 400) alert((e as any).message)
      else alert('couldn’t post that — give it another try')
      return
    }
    track('comment: posted', { via: 'inline', kind: mode })
    // the page may have moved while the note was typed (a collaborator, an
    // upload) — only mark positions that still hold the quoted text, else
    // hunt the quote down; a comment with no anchor still lives in the
    // panel by its quote
    const docSize = editor.state.doc.content.size
    let r: { from: number; to: number } | null = {
      from: Math.min(draft.from, docSize),
      to: Math.min(draft.to, docSize),
    }
    if (editor.state.doc.textBetween(r.from, r.to, ' ') !== draft.quote) {
      r = findWholeRange(editor, draft.quote)
    }
    try {
      if (r)
        editor
          .chain()
          .focus()
          .setTextSelection(r)
          .setComment(cid, mode)
          .setTextSelection(r.to)
          .run()
      else editor.commands.focus()
    } catch {
      // the comment is posted either way — a failed mark must not strand
      // the card open as if nothing happened; the panel will show it
    }
    onPosted()
    onClose()
  }

  return (
    <>
      <div className="share-backdrop" onClick={onClose} />
      <div
        className="comment-pop"
        style={{
          left: Math.max(12, Math.min(draft.x, window.innerWidth - 320)),
          // below the line — above it only when the viewport runs out; both
          // arms clamped so the card can never open outside the viewport
          // (invisible card + invisible backdrop = a page that ignores you)
          ...(draft.y + 260 > window.innerHeight
            ? { top: Math.max(272, draft.yTop - 8), transform: 'translateY(-100%)' }
            : { top: Math.max(12, draft.y + 8) }),
        }}
      >
        <div className="mode-row">
          <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>
            [ ☞ note ]
          </button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
            [ ↳ suggest an edit ]
          </button>
        </div>
        <div className={mode === 'edit' ? 'quote sugg-old' : 'quote'}>
          “{draft.quote.slice(0, 120)}”
        </div>
        <textarea
          className="ask-box"
          autoFocus
          placeholder={mode === 'note' ? 'say the thing…' : 'rewrite it as you’d have it…'}
          value={mode === 'note' ? text : sugg}
          onChange={(e) => (mode === 'note' ? setText(e.target.value) : setSugg(e.target.value))}
          onKeyDown={(e) => {
            // isComposing: an IME Enter confirms the candidate, not the post
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              post()
            }
            if (e.key === 'Escape') onClose()
          }}
        />
        {mode === 'edit' && (
          <input
            className="sugg-note"
            placeholder="why? ( optional )"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                post()
              }
              if (e.key === 'Escape') onClose()
            }}
          />
        )}
        <div className="ai-actions">
          <button onClick={post}>{mode === 'note' ? '[ post ]' : '[ suggest ]'}</button>
          <button className="faint" onClick={onClose}>
            never mind
          </button>
        </div>
      </div>
    </>
  )
}

// click a commented passage and its thread floats up beside it. no backdrop
// — the page stays fully editable while the card is up; clicking anywhere
// else (or Escape) puts it away
function CommentPop({
  editor,
  docId,
  comment,
  replies,
  at,
  onClose,
  onChanged,
}: {
  editor: TiptapEditor
  docId: string
  comment: Comment
  replies: Comment[]
  at: { x: number; y: number; yTop: number }
  onClose: () => void
  onChanged: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      // a drafted reply survives a stray Escape — close by clicking away
      const a = document.activeElement as HTMLInputElement | null
      if (a && ref.current?.contains(a) && a.value) return
      onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <>
      <div
        ref={ref}
        className="comment-pop"
        style={{
          left: Math.max(12, Math.min(at.x, window.innerWidth - 320)),
          // below the line — above it only when the viewport runs out;
          // clamped on-screen like the composer
          ...(at.y + 220 > window.innerHeight
            ? { top: Math.max(232, at.yTop - 8), transform: 'translateY(-100%)' }
            : { top: Math.max(12, at.y + 8) }),
        }}
      >
        <div className="byline">
          <span style={{ color: colorFor(comment.username) }}>{comment.username}</span>
          {comment.suggestion?.trim() ? <span className="kind"> ↳ suggests an edit</span> : null}
        </div>
        {comment.suggestion?.trim() ? (
          <div style={{ margin: '6px 0 10px' }}>
            <div className="sugg-block">
              <span className="sugg-old">{comment.quote.slice(0, 120)}</span>
              <span className="sugg-new">↳ {comment.suggestion}</span>
            </div>
            {comment.text && <div className="body faint">{comment.text}</div>}
          </div>
        ) : (
          <div className="body" style={{ margin: '6px 0 10px' }}>
            {comment.text}
          </div>
        )}
        <Replies replies={replies} />
        {comment.resolved ? (
          <div className="hint" style={{ marginTop: 8 }}>
            ( this thread is settled )
          </div>
        ) : (
          <ReplyBox docId={docId} parentId={comment.id} onPosted={onChanged}>
            {comment.suggestion?.trim() && (
              <button
                onClick={() => {
                  onClose()
                  applySuggestion(editor, comment, onChanged)
                }}
                title="replace the passage with their words"
              >
                [ ✓ apply edit ]
              </button>
            )}
            <button
              className="faint"
              onClick={async () => {
                await resolveComment(editor, comment.id)
                onChanged()
                onClose()
              }}
            >
              {comment.suggestion?.trim() ? '[ ✗ dismiss ]' : '[ ✓ resolve ]'}
            </button>
          </ReplyBox>
        )}
      </div>
    </>
  )
}

function CommentsPanel({
  editor,
  docId,
  comments,
  reload,
  focusId,
}: {
  editor: TiptapEditor
  docId: string
  comments: Comment[]
  reload: () => void
  focusId: string | null
}) {
  const open = comments.filter(isOpenRoot)
  const resolved = comments.filter((c) => c.resolved && isRoot(c))
  const repliesFor = (id: string) => comments.filter((c) => c.parent_id === id)

  // bring the lit card into view when a passage is clicked in the text
  useEffect(() => {
    if (!focusId) return
    document.getElementById(`cc-${focusId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusId])

  return (
    <div>
      <button
        onClick={() => {
          const { from, to } = editor.state.selection
          if (to <= from) {
            alert('select some text to comment on first')
            return
          }
          window.dispatchEvent(new CustomEvent('author:comment'))
        }}
      >
        [ ☞ comment on selection ]
      </button>
      <div className="hint" style={{ marginTop: 6 }}>
        select text and hit ⌥⌘M — leave a note, or write the edit yourself
      </div>
      {open.length === 0 && (
        <div className="hint" style={{ marginTop: 16 }}>
          ( no open comments )
        </div>
      )}
      {open.map((c) => {
        const jump = () => {
          const range = commentRange(editor, c)
          if (range) selectRange(editor, range)
        }
        return (
          <div
            className={focusId === c.id ? 'comment-card focus' : 'comment-card'}
            id={`cc-${c.id}`}
            key={c.id}
          >
            <div className="byline">
              <span style={{ color: colorFor(c.username) }}>{c.username}</span>
              {c.suggestion?.trim() ? <span className="kind"> ↳ suggests an edit</span> : null}
            </div>
            {c.suggestion?.trim() ? (
              <div className="sugg-block">
                <span className="sugg-old" onClick={jump} title="show me in the page">
                  {c.quote.slice(0, 120)}
                </span>
                <span className="sugg-new">↳ {c.suggestion}</span>
              </div>
            ) : (
              c.quote && (
                <div className="quote" onClick={jump} title="show me in the page">
                  “{c.quote.slice(0, 120)}”
                </div>
              )
            )}
            {c.text && <div className="body">{c.text}</div>}
            <Replies replies={repliesFor(c.id)} />
            <ReplyBox docId={docId} parentId={c.id} onPosted={reload}>
              {c.suggestion?.trim() && (
                <button
                  onClick={() => applySuggestion(editor, c, reload)}
                  title="replace the passage with their words"
                >
                  [ ✓ apply edit ]
                </button>
              )}
              <button
                className="faint"
                onClick={async () => {
                  await resolveComment(editor, c.id)
                  reload()
                }}
              >
                {c.suggestion?.trim() ? '[ ✗ dismiss ]' : '[ ✓ resolve ]'}
              </button>
            </ReplyBox>
          </div>
        )
      })}
      {resolved.length > 0 && (
        <>
          <div className="hint" style={{ marginTop: 20 }}>
            resolved —
          </div>
          {resolved.map((c) => (
            <div className="comment-card resolved" key={c.id}>
              <div className="byline">
                {c.username}
                {c.suggestion?.trim() ? <span className="kind"> ↳ suggested an edit</span> : null}
              </div>
              {c.suggestion?.trim() ? (
                <div className="sugg-block">
                  <span className="sugg-old">{c.quote.slice(0, 120)}</span>
                  <span className="sugg-new">↳ {c.suggestion}</span>
                </div>
              ) : (
                c.quote && <div className="quote">“{c.quote.slice(0, 120)}”</div>
              )}
              {c.text && <div className="body">{c.text}</div>}
              <Replies replies={repliesFor(c.id)} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// a version's face is its moment: auto saves carry no name, so the row
// shows when the words were set down
function versionMoment(t: number) {
  const d = new Date(t)
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleString(undefined, opts).toLowerCase()
}

// deliberate saves wear their given name; automatic ones wear their moment
const versionTitle = (v: Version) =>
  v.kind === 'manual' && v.name ? v.name : versionMoment(v.created_at)

type PreviewLine = { t: string; h?: boolean }

// a glanceable reading of a stored version: first dozen blocks as text,
// media as placeholders — enough to know which save is which
function previewLines(doc: any): PreviewLine[] {
  // inline runs glue together (bold mid-word stays whole); block children
  // of quotes and list items get a space so paragraphs don't run into
  // each other
  const textOf = (n: any): string =>
    n.text ??
    (n.content || [])
      .map(textOf)
      .join(n.type === 'paragraph' || n.type === 'heading' ? '' : ' ')
  const lines: PreviewLine[] = []
  for (const b of doc?.content || []) {
    if (lines.length >= 12) break
    if (b.type === 'image') lines.push({ t: '[ image ]' })
    else if (b.type === 'embed') lines.push({ t: '[ embed ]' })
    else if (b.type === 'bulletList' || b.type === 'orderedList') {
      for (const li of b.content || []) {
        if (lines.length >= 12) break
        const t = textOf(li).trim()
        if (t) lines.push({ t: '· ' + t })
      }
    } else {
      const t = textOf(b).trim()
      if (t) lines.push({ t, h: b.type === 'heading' })
    }
  }
  return lines
}

function VersionsPanel({ editor, docId }: { editor: TiptapEditor; docId: string }) {
  const [versions, setVersions] = useState<Version[]>([])
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<{
    id: string
    top: number
    right: number
    lines: PreviewLine[]
  } | null>(null)
  const previews = useRef(new Map<string, PreviewLine[]>())
  const hoverId = useRef<string | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)

  async function load() {
    setVersions(await api(`/api/docs/${docId}/versions`))
  }
  useEffect(() => {
    load()
  }, [docId])

  // the popover is pinned to hover-time coordinates — scrolling the list or
  // resizing the window would strand it, so any of those puts it away
  useEffect(() => {
    const hide = () => hidePreview()
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.clearTimeout(hoverTimer.current)
    }
  }, [])

  async function save() {
    await api(`/api/docs/${docId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ name, content: editor.getJSON() }),
    })
    track('version: saved')
    setName('')
    load()
  }

  function showPreview(v: Version, el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    hoverId.current = v.id
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(async () => {
      let lines = previews.current.get(v.id)
      if (!lines) {
        try {
          const full = await api(`/api/versions/${v.id}`)
          lines = previewLines(full.content)
          previews.current.set(v.id, lines)
        } catch {
          return
        }
      }
      // the pointer may have moved on while the version loaded
      if (hoverId.current !== v.id) return
      setPreview({
        id: v.id,
        top: Math.max(12, Math.min(rect.top, window.innerHeight - 340)),
        right: window.innerWidth - rect.left + 14,
        lines,
      })
    }, 150)
  }

  function hidePreview() {
    hoverId.current = null
    window.clearTimeout(hoverTimer.current)
    setPreview(null)
  }

  async function restore(v: Version) {
    if (!confirm('Restore this version? The current text is kept as its own version first.')) return
    const label = versionTitle(v)
    const outcome = await keepThenRestore({
      fetchVersion: () => api(`/api/versions/${v.id}`),
      // a restore is never a one-way door: keep what's on the page right now
      keep: () =>
        api(`/api/docs/${docId}/versions`, {
          method: 'POST',
          body: JSON.stringify({
            name: `before restoring “${label.slice(0, 60)}”`,
            content: editor.getJSON(),
          }),
        }),
      apply: (content) => editor.commands.setContent(content),
    })
    if (outcome === 'keep failed') {
      alert('couldn’t keep the current text as a version — nothing was restored')
      return
    }
    if (outcome === 'stale format') {
      alert('couldn’t restore this version — it may predate the current page format')
      load()
      return
    }
    track('version: restored')
    load()
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
        <div
          className="version-row"
          key={v.id}
          onMouseEnter={(e) => showPreview(v, e.currentTarget)}
          onMouseLeave={hidePreview}
        >
          <div>{versionTitle(v)}</div>
          <div className="v-meta">
            {v.username}
            {v.kind === 'manual'
              ? ' · ' + versionMoment(v.created_at)
              : v.name
                ? ' · ' + v.name
                : ''}
          </div>
          <div className="row-actions">
            <button onClick={() => restore(v)}>↺ restore</button>
          </div>
        </div>
      ))}
      {preview && preview.lines.length > 0 && (
        <div className="v-preview" style={{ top: preview.top, right: preview.right }}>
          {preview.lines.map((l, i) => (
            <div key={i} className={l.h ? 'pv-h' : undefined}>
              {l.t}
            </div>
          ))}
        </div>
      )}
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
    const openBar = () => {
      const { from, to } = editor.state.selection
      selRef.current = { from, to }
      setInstruction('')
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openBar()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('author:open-cmdk', openBar)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('author:open-cmdk', openBar)
    }
  }, [editor])

  async function run(inst: string) {
    if (!inst.trim()) return
    track('ai: command ran', {
      preset: PRESETS.includes(inst) ? inst : 'custom',
    })
    setOpen(false)
    await runAiCommand(editor, setPanel, inst, selRef.current)
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
          aria-label="instruction for the pen"
          placeholder="tell the pen what to do… ↵"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(instruction)
          }}
        />
        <div className="cmdk-or">or try one of these</div>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => run(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

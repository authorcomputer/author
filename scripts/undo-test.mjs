// Per-writer undo, end to end with the real editor stack: two headless
// Tiptap editors (jsdom) on one doc over the real websocket server. Proves
// that cmd+Z is personal — undo takes back your own last edit, not the
// other writer's more recent one — and that redo brings only yours back.
// The property lives in y-prosemirror's undo plugin (it tracks only local
// transaction origins), wired up by Collaboration when StarterKit history
// is off; this makes sure our extension stack keeps it wired.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.MutationObserver = dom.window.MutationObserver
global.requestAnimationFrame = (cb) => setTimeout(cb, 0)
global.cancelAnimationFrame = (t) => clearTimeout(t)
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)

const Y = await import('yjs')
const { WebsocketProvider } = await import('y-websocket')
const WebSocket = (await import('ws')).default
const { Editor } = await import('@tiptap/core')
const StarterKit = (await import('@tiptap/starter-kit')).default
const Collaboration = (await import('@tiptap/extension-collaboration')).default

const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const WS = BASE.replace(/^http/, 'ws') + '/ws'
const run = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json()
}
async function signup(name) {
  for (let tries = 0; ; tries++) {
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({
        email: `${name}-${run}@test.local`,
        password: 'hunter22',
        name: `${name}${run}`,
        username: `${name}${run}`,
      }),
    })
    if (res.ok) return cookieOf(res)
    // better-auth rate-limits per-path when it can't see a client IP
    if (res.status === 429 && tries < 3) {
      await sleep(1500)
      continue
    }
    throw new Error(`signup: ${res.status} ${await res.text()}`)
  }
}

function connectEditor(cookie, docId) {
  class AuthedWS extends WebSocket {
    constructor(u, protocols) {
      super(u, protocols, { headers: { Cookie: cookie } })
    }
  }
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(WS, docId, ydoc, {
    WebSocketPolyfill: AuthedWS,
    disableBc: true,
  })
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ history: false }), Collaboration.configure({ document: ydoc })],
  })
  return { editor, provider, synced: new Promise((r) => provider.once('sync', r)) }
}

const atEnd = (editor, html) =>
  editor.commands.insertContentAt(editor.state.doc.content.size, html)
const text = (editor) => editor.getText().replace(/\s+/g, ' ').trim()
const expect = (label, editor, want, wantNot) => {
  const t = text(editor)
  for (const w of want)
    if (!t.includes(w)) throw new Error(`FAIL: ${label}: expected "${w}" in "${t}"`)
  for (const w of wantNot)
    if (t.includes(w)) throw new Error(`FAIL: ${label}: expected no "${w}" in "${t}"`)
}

// ---------- two writers, one page ----------
const cookie = await signup('ink')
const { id: docId } = await post('/api/docs', { title: 'undo test' }, cookie)
const a = connectEditor(cookie, docId)
await a.synced
const b = connectEditor(cookie, docId)
await b.synced

// interleaved paragraphs: A, then B, then A again — with gaps past the
// undo manager's 500ms capture window so each lands as its own undo step
atEnd(a.editor, '<p>alpha</p>')
await sleep(700)
atEnd(b.editor, '<p>bravo</p>')
await sleep(700)
atEnd(a.editor, '<p>charlie</p>')
await sleep(700)

expect('setup on A', a.editor, ['alpha', 'bravo', 'charlie'], [])
expect('setup on B', b.editor, ['alpha', 'bravo', 'charlie'], [])
console.log('PASS: interleaved edits from two clients converge')

// ---------- B undoes: only bravo goes, though charlie is newer ----------
if (!b.editor.commands.undo()) throw new Error('FAIL: undo command refused on B')
await sleep(400)
expect('undo on B', b.editor, ['alpha', 'charlie'], ['bravo'])
expect('undo on B, seen from A', a.editor, ['alpha', 'charlie'], ['bravo'])
console.log('PASS: undo takes back your own edit, not the newest one')

// ---------- A undoes: charlie goes, alpha (also A's) stays for now ----------
if (!a.editor.commands.undo()) throw new Error('FAIL: undo command refused on A')
await sleep(400)
expect('undo on A', a.editor, ['alpha'], ['bravo', 'charlie'])
expect('undo on A, seen from B', b.editor, ['alpha'], ['bravo', 'charlie'])
console.log('PASS: each writer walks back only their own steps')

// ---------- B redoes: bravo returns, charlie stays gone ----------
if (!b.editor.commands.redo()) throw new Error('FAIL: redo command refused on B')
await sleep(400)
expect('redo on B', b.editor, ['alpha', 'bravo'], ['charlie'])
expect('redo on B, seen from A', a.editor, ['alpha', 'bravo'], ['charlie'])
console.log('PASS: redo brings back only your own edit')

a.editor.destroy()
b.editor.destroy()
a.provider.destroy()
b.provider.destroy()
console.log('ALL PASS')
process.exit(0)

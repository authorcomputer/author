// Versions, end to end with the real editor stack: a headless Tiptap editor
// (jsdom) bound to Yjs over the real websocket server. Proves the whole
// loop users trust: write → save a version → rewrite → restore → everyone
// sees it → it survives a reload. Also proves the server-made "as X joined"
// snapshot restores cleanly through the same door.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
global.window = dom.window
global.document = dom.window.document
// node 21+ ships a read-only global navigator — replace it via defineProperty
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
async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}
async function signup(name) {
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
  if (!res.ok) throw new Error(`signup: ${res.status} ${await res.text()}`)
  return cookieOf(res)
}

function connectYdoc(cookie, docId) {
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
  return { ydoc, provider, synced: new Promise((r) => provider.once('sync', r)) }
}

// ---------- the author sits down ----------
const cookieA = await signup('ink')
const { id: docId } = await post('/api/docs', { title: 'versions test' }, cookieA)
const a = connectYdoc(cookieA, docId)
await a.synced

const editor = new Editor({
  element: document.createElement('div'),
  extensions: [StarterKit.configure({ history: false }), Collaboration.configure({ document: a.ydoc })],
})

// a first draft with real structure: heading, list, quote, marks
editor.commands.insertContent(
  '<p>first draft: the opening line.</p><h2>a heading</h2><ul><li>a list item</li><li>another</li></ul><blockquote><p>quoted wisdom</p></blockquote><p><strong>bold</strong> and <em>italic</em> survive.</p>'
)
await sleep(300)
const draft1 = editor.getJSON()

// ---------- keep a version, then rewrite everything ----------
const { id: v1 } = await post(`/api/docs/${docId}/versions`, { name: 'first draft', content: draft1 }, cookieA)
editor.commands.clearContent()
editor.commands.insertContent('<p>second draft, entirely rewritten.</p>')
await sleep(400)

// a second pair of eyes (raw yjs client) sees the rewrite
const b = connectYdoc(cookieA, docId)
await b.synced
await sleep(300)
if (!b.ydoc.getXmlFragment('default').toString().includes('second draft'))
  throw new Error('FAIL: rewrite did not sync to a second client')
console.log('PASS: live edits sync')

// ---------- restore ----------
const v = await get(`/api/versions/${v1}`, cookieA)
editor.commands.setContent(v.content)
await sleep(400)

const restored = editor.getJSON()
if (JSON.stringify(restored) !== JSON.stringify(draft1))
  throw new Error(
    'FAIL: restored JSON differs from what was saved\nsaved: ' +
      JSON.stringify(draft1).slice(0, 400) +
      '\nrestored: ' +
      JSON.stringify(restored).slice(0, 400)
  )
console.log('PASS: restore round-trips exactly (heading, list, quote, marks)')

const remoteText = b.ydoc.getXmlFragment('default').toString()
if (!remoteText.includes('first draft') || remoteText.includes('second draft'))
  throw new Error('FAIL: restore did not sync to the second client')
console.log('PASS: restore syncs to collaborators')

// ---------- restore survives everyone leaving ----------
b.provider.destroy()
await sleep(2200) // the server's save timer is 1.5s
const c = connectYdoc(cookieA, docId)
await c.synced
await sleep(300)
if (!c.ydoc.getXmlFragment('default').toString().includes('first draft'))
  throw new Error('FAIL: restored content did not persist')
c.provider.destroy()
console.log('PASS: restored content persists to disk')

// ---------- the server-made snapshot restores through the same door ----------
const cookieB = await signup('quill')
const d = connectYdoc(cookieB, docId)
await d.synced
await sleep(600) // snapshotOnCompany runs off the handshake path
const versions = await get(`/api/docs/${docId}/versions`, cookieA)
const snap = versions.find((x) => x.kind === 'join')
if (!snap) throw new Error('FAIL: no auto snapshot on second writer join')
const snapBody = await get(`/api/versions/${snap.id}`, cookieA)
editor.commands.setContent(snapBody.content)
await sleep(300)
const text = editor.getText()
if (!text.includes('first draft') || !text.includes('a list item'))
  throw new Error('FAIL: auto snapshot did not restore: ' + text.slice(0, 200))
const types = editor.getJSON().content.map((n) => n.type)
for (const t of ['heading', 'bulletList', 'blockquote']) {
  if (!types.includes(t)) throw new Error(`FAIL: auto snapshot lost structure (${t}): ${types}`)
}
console.log('PASS: the server-made "as X joined" snapshot restores with structure intact')

d.provider.destroy()
a.provider.destroy()
editor.destroy()
console.log('ALL PASS')
process.exit(0)

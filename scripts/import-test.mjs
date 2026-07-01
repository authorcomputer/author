// Simulates the client-side .md import pipeline end-to-end against a running server.
import StarterKit from '@tiptap/starter-kit'
import { getSchema } from '@tiptap/core'
import { generateJSON } from '@tiptap/html'
import { marked } from 'marked'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import WebSocket from 'ws'

const [token] = process.argv.slice(2)
const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const WS = process.env.AUTHOR_WS_URL || 'ws://localhost:3001/ws'

const md = `# The Keeper's Ledger

The lighthouse keeper counted ships the way other men counted **debts**.

- each safe passage, a small forgiveness
- each loss, a weight on the spiral stairs

> Her letters smelled faintly of a city he had never seen.
`

let title = 'import-test'
let body = md
const m = body.match(/^#[ \t]+(.+)[ \t]*\r?\n+/)
if (m) {
  title = m[1].trim()
  body = body.slice(m[0].length)
}
const html = await marked.parse(body)
console.log('html:', html.replace(/\n/g, '').slice(0, 120))

const res = await fetch(`${BASE}/api/docs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title }),
})
const { id } = await res.json()
console.log('created doc', id)

const extensions = [StarterKit]
const schema = getSchema(extensions)
const json = generateJSON(html, extensions)
const update = Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, json, 'default'))

const ydoc = new Y.Doc()
const provider = new WebsocketProvider(WS, id, ydoc, {
  WebSocketPolyfill: WebSocket,
  params: { token },
})
await new Promise((r, j) => {
  const t = setTimeout(() => j(new Error('sync timeout')), 10000)
  provider.once('sync', () => {
    clearTimeout(t)
    r()
  })
})
Y.applyUpdate(ydoc, update)
ydoc.getMap('meta').set('title', title)
await fetch(`${BASE}/api/docs/${id}/html`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ html }),
})
await new Promise((r) => setTimeout(r, 500))
provider.destroy()
ydoc.destroy()

// verify: reconnect fresh and read back
const check = new Y.Doc()
const p2 = new WebsocketProvider(WS, id, check, { WebSocketPolyfill: WebSocket, params: { token } })
await new Promise((r) => p2.once('sync', r))
const content = check.getXmlFragment('default').toString()
const gotTitle = check.getMap('meta').get('title')
console.log('read back title:', gotTitle)
console.log('read back content:', content.slice(0, 200))
const pass =
  gotTitle === "The Keeper's Ledger" &&
  content.includes('counted ships') &&
  content.includes('<bold>debts</bold>') &&
  content.toLowerCase().includes('listitem') &&
  content.toLowerCase().includes('blockquote')
console.log(pass ? 'PASS: import pipeline works' : 'FAIL')
p2.destroy()
process.exit(pass ? 0 : 1)

// a visit is not a change: opening a doc's room and leaving must not move
// updated_at (the desk's sort key); a real edit must.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const BASE = 'http://localhost:3001'

async function signup() {
  const res = await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `visit-${Date.now()}@test.dev`,
      password: 'hunter22',
    }),
  })
  if (!res.ok) throw new Error(`signup ${res.status}`)
  const cookie = (res.headers.getSetCookie() || [])
    .map((c) => c.split(';')[0])
    .join('; ')
  return cookie
}

const cookie = await signup()
const api = (path, opts = {}) =>
  fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opts.headers || {}) },
  }).then((r) => r.json())

class AuthedWS extends WebSocket {
  constructor(url, protocols) {
    super(url, protocols, { headers: { Cookie: cookie } })
  }
}

const { id } = await api('/api/docs', { method: 'POST', body: '{}' })

// seed some content in a first session, so the visit has something to read
await session(async (ydoc) => {
  ydoc.getMap('meta').set('title', 'visit test')
})
const before = await stamp()

// the visit: sync, linger, leave — no edits
await session(async () => {})
// the room persists on last-close; give it a beat, then unload window too
await new Promise((r) => setTimeout(r, 800))
const afterVisit = await stamp()

// a real edit
await session(async (ydoc) => {
  ydoc.getMap('meta').set('title', 'visit test, edited')
})
await new Promise((r) => setTimeout(r, 2200))
const afterEdit = await stamp()

let fail = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!ok) fail = 1
}
check(afterVisit === before, `a visit leaves updated_at alone (${before} → ${afterVisit})`)
check(afterEdit > before, `an edit moves updated_at (${before} → ${afterEdit})`)
process.exit(fail)

async function stamp() {
  const docs = await api('/api/docs')
  return docs.find((d) => d.id === id).updated_at
}

async function session(fn) {
  const ydoc = new Y.Doc()
  const p = new WebsocketProvider('ws://localhost:3001/ws', id, ydoc, {
    WebSocketPolyfill: AuthedWS,
  })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no sync')), 8000)
    p.once('sync', () => {
      clearTimeout(t)
      resolve()
    })
  })
  await fn(ydoc)
  // let a scheduled save (1.5s debounce) land before the socket drops
  await new Promise((r) => setTimeout(r, 2000))
  p.destroy()
  ydoc.destroy()
}

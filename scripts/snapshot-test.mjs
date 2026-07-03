// End-to-end check: a version named "before <joiner> joined" appears when a
// second distinct user connects to a doc that already has text.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const BASE = 'http://localhost:4999'
const WS = 'ws://localhost:4999/ws'
const run = Date.now().toString(36)

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
  if (!res.ok) throw new Error(`signup ${name}: ${res.status} ${await res.text()}`)
  const cookie = (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('no session cookie')
  return cookie
}

function connect(cookie, docId) {
  class AuthedWS extends WebSocket {
    constructor(u, protocols) {
      super(u, protocols, { headers: { Cookie: cookie } })
    }
  }
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(WS, docId, doc, { WebSocketPolyfill: AuthedWS })
  return {
    doc,
    provider,
    synced: new Promise((res) => provider.once('sync', res)),
  }
}

const cookieA = await signup('ink')
const cookieB = await signup('quill')

const created = await fetch(`${BASE}/api/docs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ title: 'snap test' }),
})
const { id: docId } = await created.json()
console.log('doc:', docId)

// A connects and writes something
const a = connect(cookieA, docId)
await a.synced
a.doc.transact(() => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('the solo draft, before company')])
  a.doc.getXmlFragment('default').insert(0, [p])
})
await new Promise((r) => setTimeout(r, 500))

// B joins — this crossing should mint the snapshot
const b = connect(cookieB, docId)
await b.synced
await new Promise((r) => setTimeout(r, 500))

const versions = await (
  await fetch(`${BASE}/api/docs/${docId}/versions`, { headers: { Cookie: cookieA } })
).json()
console.log('versions:', JSON.stringify(versions, null, 2))

const snap = versions.find((v) => v.name === `as quill${run} joined`)
if (!snap) throw new Error('FAIL: no auto snapshot: ' + JSON.stringify(versions))
const body = await (
  await fetch(`${BASE}/api/versions/${snap.id}`, { headers: { Cookie: cookieA } })
).json()
const text = JSON.stringify(body.content)
if (!text.includes('the solo draft, before company')) throw new Error('FAIL: snapshot missing text')
console.log('PASS: snapshot exists, credited to', snap.username, '— content intact')

// reconnect B again — throttle means no second version
b.provider.destroy()
await new Promise((r) => setTimeout(r, 300))
const b2 = connect(cookieB, docId)
await b2.synced
await new Promise((r) => setTimeout(r, 500))
const versions2 = await (
  await fetch(`${BASE}/api/docs/${docId}/versions`, { headers: { Cookie: cookieA } })
).json()
if (versions2.length !== versions.length) throw new Error('FAIL: throttle did not hold')
console.log('PASS: rejoin within the gap adds nothing')

a.provider.destroy()
b2.provider.destroy()
process.exit(0)

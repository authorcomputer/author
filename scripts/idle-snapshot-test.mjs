// End-to-end check for the idle snapshot: five minutes (here shrunk via
// AUTHOR_IDLE_SNAP_MS) without a change mints a version named "as the ink
// dried". Two modes, keyed on the gap the server was booted with:
//   gap < 30s  → the timer path: pause mints one, silence adds nothing,
//                a fresh edit re-arms it for exactly one more
//   gap > 35s  → the flush path: edit, leave, and the room's 30s unload
//                flushes the pending version early — if it shows up before
//                the gap has elapsed, only the flush could have made it
// Boot the server with the matching AUTHOR_IDLE_SNAP_MS before each run.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const WS = BASE.replace(/^http/, 'ws') + '/ws'
const GAP = Number(process.env.AUTHOR_IDLE_SNAP_MS) || 1500
const run = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

const cookie = await signup('ink')
const created = await fetch(`${BASE}/api/docs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ title: 'idle snap test' }),
})
const { id: docId } = await created.json()
console.log('doc:', docId, 'gap:', GAP)

const versionsNow = async () =>
  (await fetch(`${BASE}/api/docs/${docId}/versions`, { headers: { Cookie: cookie } })).json()
const write = (conn, text) =>
  conn.doc.transact(() => {
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText(text)])
    conn.doc.getXmlFragment('default').insert(0, [p])
  })

const a = connect(cookie, docId)
await a.synced

if (GAP > 35_000) {
  // flush mode: the edit's timer is still far from firing when the writer
  // leaves; the room unloads ~30s later and must flush the version then
  write(a, 'a parting line')
  await sleep(300)
  a.provider.destroy()
  await sleep(33_000)
  const versions = await versionsNow()
  const dried = versions.filter((v) => v.name === 'as the ink dried')
  if (dried.length !== 1)
    throw new Error('FAIL: unload did not flush the pending snapshot: ' + JSON.stringify(versions))
  console.log('PASS: leaving flushes the pending version, credited to', dried[0].username)
  process.exit(0)
}

write(a, 'written, then the pen rests')

// 1) the pause mints a version
await sleep(GAP + 1000)
let versions = await versionsNow()
const snap = versions.find((v) => v.name === 'as the ink dried')
if (!snap) throw new Error('FAIL: no idle snapshot: ' + JSON.stringify(versions))
const body = await (
  await fetch(`${BASE}/api/versions/${snap.id}`, { headers: { Cookie: cookie } })
).json()
if (!JSON.stringify(body.content).includes('written, then the pen rests'))
  throw new Error('FAIL: idle snapshot missing text')
console.log('PASS: idle snapshot exists, credited to', snap.username, '— content intact')

// 2) continued silence adds nothing — the timer only re-arms on a change
await sleep(GAP + 1000)
const after = await versionsNow()
if (after.length !== versions.length)
  throw new Error('FAIL: idle without a change kept versioning')
console.log('PASS: silence without a change adds nothing')

// 3) a new edit re-arms it for exactly one more
write(a, 'a second thought')
await sleep(GAP + 1000)
versions = await versionsNow()
const dried = versions.filter((v) => v.name === 'as the ink dried')
if (dried.length !== 2) throw new Error('FAIL: expected 2 idle snapshots, got ' + dried.length)
console.log('PASS: a fresh edit re-arms the timer')

a.provider.destroy()
process.exit(0)

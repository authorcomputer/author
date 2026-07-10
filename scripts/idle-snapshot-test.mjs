// End-to-end check for the idle snapshot: five minutes (here shrunk via
// AUTHOR_IDLE_SNAP_MS) without a change mints an unnamed kind='idle'
// version. Two modes, keyed on the gap the server was booted with:
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
  const res = await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({
      email: `${name}-${run}@test.local`,
      password: 'hunter22',
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
  const dried = versions.filter((v) => v.kind === 'idle')
  if (dried.length !== 1)
    throw new Error('FAIL: unload did not flush the pending snapshot: ' + JSON.stringify(versions))
  console.log('PASS: leaving flushes the pending version, credited to', dried[0].username)
  process.exit(0)
}

write(a, 'written, then the pen rests')

// 1) the pause mints a version
await sleep(GAP + 1000)
let versions = await versionsNow()
const snap = versions.find((v) => v.kind === 'idle')
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
const dried = versions.filter((v) => v.kind === 'idle')
if (dried.length !== 2) throw new Error('FAIL: expected 2 idle snapshots, got ' + dried.length)
console.log('PASS: a fresh edit re-arms the timer')

// 4) a long unbroken session gets kept mid-flow — write continuously past
// the active gap without ever going idle (needs AUTHOR_ACTIVE_SNAP_MS on
// the server; skipped when the env var is absent)
const ACTIVE = Number(process.env.AUTHOR_ACTIVE_SNAP_MS)
if (ACTIVE) {
  // the first stroke after a break starts the flow clock — it must never
  // count the silence before it as flow
  await sleep(ACTIVE + 500)
  write(a, 'a lone returning keystroke')
  await sleep(600)
  const early = (await versionsNow()).filter((v) => v.kind === 'flow')
  if (early.length) throw new Error('FAIL: a single keystroke after a break minted a mid-flow version')
  console.log('PASS: a return after a break is not mistaken for flow')

  const start = Date.now()
  let i = 0
  while (Date.now() - start < ACTIVE + 1000) {
    write(a, `flow line ${i++}`)
    await sleep(Math.min(400, GAP / 3))
  }
  await sleep(500)
  versions = await versionsNow()
  const flowed = versions.filter((v) => v.kind === 'flow')
  if (flowed.length < 1) throw new Error('FAIL: no mid-flow snapshot during continuous writing')
  console.log('PASS: a long session is kept mid-flow, credited to', flowed[0].username)
  await sleep(GAP + 1000) // let the trailing idle version land before the next check
}

// 5) a manual save after the last edit already holds the settled state —
// the idle timer must stand down instead of doubling it
write(a, 'a third thought')
await sleep(300)
const saved = await fetch(`${BASE}/api/docs/${docId}/versions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({
    name: 'kept by hand',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a third thought' }] }] },
  }),
})
if (!saved.ok) throw new Error(`FAIL: manual save refused: ${saved.status} ${await saved.text()}`)
await sleep(GAP + 1000)
versions = await versionsNow()
// the flow phase (when run) legitimately adds trailing idle versions;
// what must NOT appear is one minted after the manual save
const manual = versions.find((v) => v.name === 'kept by hand')
if (!manual) throw new Error('FAIL: manual version missing from the list')
if (versions.some((v) => v.kind === 'idle' && v.created_at > manual.created_at))
  throw new Error('FAIL: idle snapshot duplicated a manual save')
console.log('PASS: a manual save stands the idle timer down')

a.provider.destroy()
process.exit(0)

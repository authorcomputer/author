// The socket boundary, both ways it can be abused.
//   presence: a crafted awareness frame naming another writer's clientId must
//             not override or, on the forger's close, erase their cursor.
//   crash:    a TCP reset mid-auth (before ws adopts the socket) must not take
//             the whole process down — an uncaughtException would skip
//             flushRooms() and lose every loaded room's unsaved edits.
// Both halves FAIL on the pre-fix server (that is the negative control).
import net from 'node:net'
import crypto from 'node:crypto'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
import * as encoding from 'lib0/encoding'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const WS = BASE.replace(/^http/, 'ws') + '/ws'
const run = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = false
const check = (ok, msg) => {
  console.log((ok ? 'PASS: ' : 'FAIL: ') + msg)
  if (!ok) failed = true
}

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
  return (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
}

function connect(cookie, docId) {
  class AuthedWS extends WebSocket {
    constructor(u, protocols) {
      super(u, protocols, { headers: { Cookie: cookie } })
    }
  }
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(WS, docId, doc, {
    WebSocketPolyfill: AuthedWS,
    disableBc: true,
  })
  return { doc, provider, synced: new Promise((r) => provider.once('sync', r)) }
}

const nameFor = (aw, clientId) => aw.getStates().get(clientId)?.user?.name

// ---------- setup ----------
const cookie = await signup('ink')
const created = await fetch(`${BASE}/api/docs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie },
  body: JSON.stringify({ title: 'ws boundary test' }),
})
const { id: docId } = await created.json()

// ---------- 1. presence forgery ----------
const victim = connect(cookie, docId)
const observer = connect(cookie, docId)
await Promise.all([victim.synced, observer.synced])
victim.provider.awareness.setLocalStateField('user', { name: 'victim', color: '#f00' })
const victimId = victim.doc.clientID
await sleep(400)

check(
  nameFor(observer.provider.awareness, victimId) === 'victim',
  'observer sees the victim before any forgery'
)

// a raw frame naming another writer's cursor: same clientId, an unreachable
// clock, a state of its choosing. the forger is a *different account* — that
// is the only thing that separates a thief from a writer whose wifi dropped
const strangerCookie = await signup('quill')
const forgeFrame = (clientId, name) => {
  const inner = encoding.createEncoder()
  encoding.writeVarUint(inner, 1) // one entry
  encoding.writeVarUint(inner, clientId)
  encoding.writeVarUint(inner, 1 << 30) // a clock the victim will never reach
  encoding.writeVarString(inner, JSON.stringify({ user: { name, color: '#000' } }))
  const frame = encoding.createEncoder()
  encoding.writeVarUint(frame, 1) // MESSAGE_AWARENESS
  encoding.writeVarUint8Array(frame, encoding.toUint8Array(inner))
  return encoding.toUint8Array(frame)
}
const rawSocket = async (cookie) => {
  const ws = new WebSocket(`${WS}/${docId}`, { headers: { Cookie: cookie } })
  ws.binaryType = 'arraybuffer'
  await new Promise((r, j) => {
    ws.once('open', r)
    ws.once('error', j)
  })
  return ws
}

// the doc must be open to the stranger before their socket is allowed in
await fetch(`${BASE}/api/docs/${docId}/open`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: strangerCookie },
})
const attacker = await rawSocket(strangerCookie)
attacker.send(forgeFrame(victimId, 'imposter'))
await sleep(500)

check(
  nameFor(observer.provider.awareness, victimId) === 'victim',
  'a stranger’s forged frame did not override the victim to everyone else'
)

attacker.close()
await sleep(600)

check(
  nameFor(observer.provider.awareness, victimId) === 'victim',
  'closing the forger did not erase the victim from everyone else'
)

// ---------- 1b. a reconnect is not a forger ----------
// y-websocket keeps its clientID across a drop, and a half-open socket can
// still be registered when the new one arrives. the writer's own second
// socket must be able to reclaim its cursor — and the stale socket's eventual
// close must not take that live cursor with it
const rejoin = await rawSocket(cookie)
rejoin.send(forgeFrame(victimId, 'victim-again'))
await sleep(500)

check(
  nameFor(observer.provider.awareness, victimId) === 'victim-again',
  'the writer’s own reconnect reclaimed their cursor'
)

// the stale socket dies without a goodbye, exactly as a half-open one does.
// terminate, not destroy: a graceful disconnect announces its own departure
// and the server rightly honours it — a dropped laptop announces nothing
victim.provider.shouldConnect = false
victim.provider.ws.terminate()
await sleep(700)

check(
  nameFor(observer.provider.awareness, victimId) === 'victim-again',
  'reaping the stale socket did not erase the reconnected writer'
)

rejoin.close()
victim.provider.destroy()
observer.provider.destroy()
await sleep(200)

// ---------- 2. reset-mid-auth crash ----------
const { hostname, port } = new URL(BASE)
function resetDuringAuth() {
  return new Promise((resolve) => {
    const sock = net.connect(Number(port), hostname)
    sock.on('error', () => resolve()) // our side dying is fine; the server's is the test
    sock.on('connect', () => {
      const key = crypto.randomBytes(16).toString('base64')
      sock.write(
        `GET /ws/${docId} HTTP/1.1\r\n` +
          `Host: ${hostname}:${port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n` +
          `Cookie: ${cookie}\r\n\r\n`
      )
      // reset once the server has read the request and is inside getUser's await
      setTimeout(() => {
        try {
          sock.resetAndDestroy()
        } catch {
          sock.destroy()
        }
        resolve()
      }, 1 + Math.floor(Math.random() * 6))
    })
  })
}

for (let i = 0; i < 300; i++) {
  await resetDuringAuth()
}
await sleep(400)

let alive = false
try {
  const res = await fetch(`${BASE}/`, { headers: { Cookie: cookie } })
  alive = res.status > 0
} catch {
  alive = false
}
check(alive, 'the server survived 300 resets mid-auth (no uncaughtException crash)')

console.log(failed ? 'SUITE FAIL' : 'ALL PASS')
process.exit(failed ? 1 : 0)

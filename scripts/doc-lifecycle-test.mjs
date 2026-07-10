// The three ways a page can die under a live room — deleted from another
// tab, collected by the nightly ghost sweep, or stored as bytes that won't
// parse — and the invariant each must keep: delete tears the room down
// (no ghost saves, no orphan versions), the sweep spares any page someone
// has open, and a blob that fails to load is never overwritten by the
// empty stand-in a broken room serves — yet real content typed into that
// stand-in heals the room and is saved, so restore is not a dead end.
//
// Boot the server with AUTHOR_IDLE_SNAP_MS=1200 AUTHOR_SWEEP_MS=1500.
// Reads the server's own SQLite file (AUTHOR_DB, default data/author.db)
// to see what actually landed on disk.
import path from 'node:path'
import Database from 'better-sqlite3'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const WS = BASE.replace(/^http/, 'ws') + '/ws'
const sdb = new Database(process.env.AUTHOR_DB || path.join(process.cwd(), 'data', 'author.db'))
const run = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const check = (ok, name) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) failed++
}

const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
async function req(method, path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}
const post = (p, b, c) => req('POST', p, b, c)
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
  return cookieOf(res)
}
async function ghostIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: '{}',
  })
  if (!res.ok) throw new Error(`ghost sign-in: ${res.status} ${await res.text()}`)
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

const typeInto = (ydoc, text) => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  ydoc.getXmlFragment('default').insert(0, [p])
}

// expiresAt rides in whatever shape better-auth wrote it — match it
function expireSessions(userId) {
  const row = sdb.prepare('SELECT expiresAt FROM session WHERE userId = ?').get(userId)
  const past = typeof row?.expiresAt === 'number' ? 1 : '2000-01-01T00:00:00.000Z'
  sdb.prepare('UPDATE session SET expiresAt = ? WHERE userId = ?').run(past, userId)
}

// ---------- 1. delete from another tab tears the live room down ----------
const cookieA = await signup('ink')
const { id: doomed } = await post('/api/docs', { title: 'doomed' }, cookieA)
const a = connectYdoc(cookieA, doomed)
await a.synced
typeInto(a.ydoc, 'words typed right before the delete')
await sleep(400) // the edit lands; the server's idle-snapshot timer arms
await req('DELETE', `/api/docs/${doomed}`, undefined, cookieA)
await sleep(2500) // past the 1.2s idle snap and the 1.5s save debounce
check(!a.provider.wsconnected, 'delete cuts off a connected editor')
check(
  sdb.prepare('SELECT COUNT(*) AS c FROM versions WHERE doc_id = ?').get(doomed).c === 0,
  'delete leaves no orphan versions behind'
)
check(
  !sdb.prepare('SELECT id FROM docs WHERE id = ?').get(doomed),
  'the doc row itself is gone'
)
a.provider.destroy()

// ---------- 2. the sweep spares a page someone has open ----------
const ghostCookie = await ghostIn()
const ghostId = (await req('GET', '/api/me', undefined, ghostCookie)).id
const { id: kept } = await post('/api/docs', { title: 'kept' }, ghostCookie)

// a reader arrives first — the room is live before the ghost goes stale
const cookieB = await signup('quill')
await post(`/api/docs/${kept}/open`, {}, cookieB)
const b = connectYdoc(cookieB, kept)
await b.synced

// now age the ghost past the sweep's line: sessions expired, page untouched
// for 15 days (the reader hasn't typed, so updated_at stays stale)
const staleMs = Date.now() - 15 * 24 * 60 * 60 * 1000
sdb.prepare('UPDATE docs SET updated_at = ? WHERE id = ?').run(staleMs, kept)
expireSessions(ghostId)

// a control ghost with the same staleness and no one at the page
const ghost2Cookie = await ghostIn()
const ghost2Id = (await req('GET', '/api/me', undefined, ghost2Cookie)).id
const { id: adrift } = await post('/api/docs', { title: 'adrift' }, ghost2Cookie)
sdb.prepare('UPDATE docs SET updated_at = ? WHERE id = ?').run(staleMs, adrift)
expireSessions(ghost2Id)

await sleep(4000) // at least two 1.5s sweep ticks
check(!!sdb.prepare('SELECT id FROM docs WHERE id = ?').get(kept), 'sweep spares a doc with a live room')
check(!!sdb.prepare('SELECT id FROM user WHERE id = ?').get(ghostId), 'sweep spares the whole ghost while their page is open')
check(b.provider.wsconnected, 'the reader is still connected after the sweep')
check(!sdb.prepare('SELECT id FROM docs WHERE id = ?').get(adrift), 'sweep still collects a drifted ghost no one is reading')
check(!sdb.prepare('SELECT id FROM user WHERE id = ?').get(ghost2Id), 'the drifted ghost user row goes with it')
b.provider.destroy()

// ---------- 3. a blob that won't load is never overwritten ----------
const { id: fragile } = await post('/api/docs', { title: 'fragile' }, cookieA)
const garbage = Buffer.from('these twenty bytes!!')
sdb.prepare('UPDATE docs SET ydoc = ? WHERE id = ?').run(garbage, fragile)
const c = connectYdoc(cookieA, fragile)
await c.synced // the room serves an empty stand-in; that's fine to read
await sleep(300)
c.provider.destroy() // last connection out persists the room — or must not
await sleep(800)
const blob = sdb.prepare('SELECT ydoc FROM docs WHERE id = ?').get(fragile).ydoc
check(
  blob && Buffer.compare(Buffer.from(blob), garbage) === 0,
  'the unparseable blob survives the room untouched'
)

// ---------- 4. real content heals a broken room and persists ----------
// the recovery path the refusal must not block: a corrupt blob, opened, then
// given words. the stand-in stops being a stand-in — the save proceeds and
// the doc reloads from disk carrying what was typed.
const { id: healed } = await post('/api/docs', { title: 'healed' }, cookieA)
const garbage2 = Buffer.from('twenty broken bytes!')
sdb.prepare('UPDATE docs SET ydoc = ? WHERE id = ?').run(garbage2, healed)
const d = connectYdoc(cookieA, healed)
await d.synced // empty stand-in, same as the fragile room above
typeInto(d.ydoc, 'words that heal the broken doc')
await sleep(400) // the edit reaches the server
d.provider.destroy() // last out persists — and now there is content to keep
await sleep(800)
const healedBlob = sdb.prepare('SELECT ydoc FROM docs WHERE id = ?').get(healed).ydoc
check(
  healedBlob && Buffer.compare(Buffer.from(healedBlob), garbage2) !== 0,
  'real content overwrites the broken blob'
)
// reload the way a fresh room would: parse the stored bytes into a new doc
let reloaded = ''
try {
  const rdoc = new Y.Doc()
  Y.applyUpdate(rdoc, new Uint8Array(healedBlob))
  reloaded = rdoc.getXmlFragment('default').toString()
} catch {}
check(
  reloaded.includes('words that heal the broken doc'),
  'the healed blob reloads with the typed content'
)

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL PASS')
process.exit(0)

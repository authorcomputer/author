// Three ledgers the server keeps, and the lie each must not tell: orphan-image
// cleanup must count version history as a referrer (a restore has to find its
// pictures), a handle rename must follow the pen's id and never a byline
// string another pen can share, and the site-wide AI budget must count each
// real request once — a ghost's ip shadow row is a charge, not a request.
//
// Boot the server with AUTHOR_IDLE_SNAP_MS=1200 AI_GLOBAL_DAILY_CAP=4
// ANTHROPIC_API_KEY=sk-ant-bogus. Reads the server's own SQLite file
// (AUTHOR_DB, default data/author.db) and the uploads dir beside it.
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const WS = BASE.replace(/^http/, 'ws') + '/ws'
const dbPath = process.env.AUTHOR_DB || path.join(process.cwd(), 'data', 'author.db')
const sdb = new Database(dbPath)
const uploadsDir = path.join(path.dirname(dbPath), 'uploads')
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

// ---------- 1. version history keeps a file the current text let go ----------
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const cookieA = await signup('ink')
const { id: docA } = await post('/api/docs', { title: 'holder' }, cookieA)
const up = await fetch(`${BASE}/api/docs/${docA}/images`, {
  method: 'POST',
  headers: { 'Content-Type': 'image/png', Origin: BASE, Cookie: cookieA },
  body: png,
})
if (!up.ok) throw new Error(`upload: ${up.status} ${await up.text()}`)
const { url } = await up.json()
const onDisk = () => fs.existsSync(path.join(uploadsDir, path.basename(url)))

// the picture is kept in a version, then cut from the living text
await post(
  `/api/docs/${docA}/versions`,
  { name: 'with picture', content: { type: 'doc', content: [{ type: 'image', attrs: { src: url } }] } },
  cookieA
)
await post(`/api/docs/${docA}/html`, { html: '<p>the picture was cut from here</p>' }, cookieA)

// a second doc borrowed the same file by copy-paste, then dies
const { id: docB } = await post('/api/docs', { title: 'borrower' }, cookieA)
await post(`/api/docs/${docB}/html`, { html: `<p>borrowed</p><img src="${url}">` }, cookieA)
await req('DELETE', `/api/docs/${docB}`, undefined, cookieA)
await sleep(300)
check(onDisk(), 'a file still named by version history survives its last living reference dying')

// once the protecting version goes with its doc, cleanup still works
const { id: docC } = await post('/api/docs', { title: 'last holder' }, cookieA)
await post(`/api/docs/${docC}/html`, { html: `<img src="${url}">` }, cookieA)
await req('DELETE', `/api/docs/${docA}`, undefined, cookieA)
await req('DELETE', `/api/docs/${docC}`, undefined, cookieA)
await sleep(300)
check(!onDisk(), 'with no doc or version left naming it, the file is still cleaned up')

// ---------- 2. a rename moves the renamer's bylines and no one else's ----------
const pen = `riley${run}`
const ghostCookie = await ghostIn()
await post('/api/name', { name: pen }, ghostCookie)
const { id: ghostDoc } = await post('/api/docs', { title: 'ghost pages' }, ghostCookie)
const g = connectYdoc(ghostCookie, ghostDoc)
await g.synced
typeInto(g.ydoc, 'a ghost writes alone')
await sleep(2600) // past the 1.2s idle snap and the 1.5s save debounce
g.provider.destroy()
const ghostVersion = () =>
  sdb.prepare('SELECT username FROM versions WHERE doc_id = ?').get(ghostDoc)
check(ghostVersion()?.username === pen, 'the idle snapshot signs with the pen name')

// an unrelated writer takes the same name as a handle, keeps a version
// under it, then moves on — only their own byline may follow
const impostorCookie = await signup('impostor')
await post('/api/handle', { username: pen }, impostorCookie)
const { id: ownDoc } = await post('/api/docs', { title: 'own pages' }, impostorCookie)
await post(
  `/api/docs/${ownDoc}/versions`,
  { name: 'kept', content: { type: 'doc', content: [] } },
  impostorCookie
)
await post('/api/handle', { username: `max${run}` }, impostorCookie)
check(
  sdb.prepare('SELECT username FROM versions WHERE doc_id = ?').get(ownDoc)?.username ===
    `max${run}`,
  "the renamer's own bylines follow the rename"
)
check(
  ghostVersion()?.username === pen,
  "a stranger's byline wearing the same name stays put through the rename"
)

// ---------- 3. the desk budget counts requests, not shadow rows ----------
// boot cap is 4. two ghost requests leave four rows (user + ip shadow) but
// are only two real calls — the desk must still have room. today's ledger is
// cleared first so reruns against the same db stay deterministic.
const day = new Date().toISOString().slice(0, 10)
sdb.prepare('DELETE FROM ai_usage WHERE day = ?').run(day)
sdb.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 2)').run(`ghost-${run}`, day)
sdb.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 2)').run('ip:203.0.113.7', day)
const ask = () =>
  fetch(`${BASE}/api/ai/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: impostorCookie },
    body: JSON.stringify({ text: 'a draft about ledgers' }),
  })
const roomy = await ask()
check(roomy.status !== 429, `ip shadow rows do not spend the desk budget twice (got ${roomy.status})`)

// and the cap itself still holds once four real requests have landed
sdb.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 2)').run(`writer-${run}`, day)
const full = await ask()
check(full.status === 429, `four real requests against a cap of four still close the desk (got ${full.status})`)

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL PASS')
process.exit(0)

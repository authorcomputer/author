// The edit entry's word count and the sitting-scoped collapse, end to end:
// one sitting is one history line wearing its net words; a new sitting gets
// a new line; a long sitting's flow snapshots collapse and their counts sum.
// Boot the server with AUTHOR_IDLE_SNAP_MS=1500 AUTHOR_ACTIVE_SNAP_MS=4000.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const WS = BASE.replace(/^http/, 'ws') + '/ws'
const GAP = Number(process.env.AUTHOR_IDLE_SNAP_MS) || 1500
const ACTIVE = Number(process.env.AUTHOR_ACTIVE_SNAP_MS) || 4000
const run = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failed = 1
}

const res = await fetch(`${BASE}/api/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: `sum-${run}@test.local`, password: 'hunter22' }),
})
if (!res.ok) throw new Error(`signup: ${res.status}`)
const cookie = (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
const { id: docId } = await (
  await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE },
    body: JSON.stringify({ title: 'edit summary test' }),
  })
).json()

class AuthedWS extends WebSocket {
  constructor(u, protocols) {
    super(u, protocols, { headers: { Cookie: cookie } })
  }
}
const ydoc = new Y.Doc()
const provider = new WebsocketProvider(WS, docId, ydoc, { WebSocketPolyfill: AuthedWS })
await new Promise((r) => provider.once('sync', r))

const write = (text) =>
  ydoc.transact(() => {
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText(text)])
    ydoc.getXmlFragment('default').insert(0, [p])
  })
const editRows = async () => {
  const evs = await (
    await fetch(`${BASE}/api/docs/${docId}/events`, { headers: { Cookie: cookie } })
  ).json()
  return evs.filter((e) => e.type === 'edit')
}

// sitting one: five words, then the pen rests
const sittingOneAt = Date.now()
write('one two three four five')
await sleep(GAP + 1100)
let rows = await editRows()
ok(rows.length === 1, 'one sitting, one line')
ok(rows[0].detail === '+5 words', `the line wears its words (${rows[0].detail})`)

// sitting two: a separate line, not a swollen first one. its far edge is
// the version sitting one settled into — after sitting one began, before
// sitting two's own words
const sittingTwoAt = Date.now()
write('six seven eight')
await sleep(GAP + 1100)
rows = await editRows()
ok(rows.length === 2, 'a new sitting gets its own line')
ok(rows[0].detail === '+3 words', `the new line counts only its own (${rows[0].detail})`)
ok(rows[1].detail === '+5 words', 'the old line keeps its count')
ok(
  rows[0].started_at > sittingOneAt && rows[0].started_at <= sittingTwoAt + 1000,
  'the new line anchors past the old sitting'
)

// sitting three: flow long enough to snapshot mid-run — the run stays one
// line and the counts sum
const sittingThreeAt = Date.now()
let words = 0
const start = Date.now()
while (Date.now() - start < ACTIVE + 800) {
  write('flowing words here') // three words a stroke
  words += 3
  await sleep(300)
}
await sleep(GAP + 1100)
rows = await editRows()
ok(rows.length === 3, 'a long sitting collapses to one line')
ok(rows[0].detail === `+${words} words`, `the collapsed line sums the run (+${words} vs ${rows[0].detail})`)
ok(
  rows[0].started_at > sittingTwoAt && rows[0].started_at <= sittingThreeAt + 1000,
  'the collapsed line anchors past the previous sitting'
)

provider.destroy()
process.exit(failed)

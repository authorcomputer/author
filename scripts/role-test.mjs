// commenter role e2e: the review door enrolls to speak, not to write —
// checked at every surface: http endpoints, roles on meta, and the yjs wire.
// the writing door is the wider key: walking through it grants the pen.
import WebSocket from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const WSBASE = BASE.replace(/^http/, 'ws')
const run = Date.now().toString(36)
let failed = 0
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failed = 1
}
const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
async function raw(method, path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
async function req(method, path, body, cookie) {
  const res = await raw(method, path, body, cookie)
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res
}
const post = (p, b, c) => req('POST', p, b, c)
const jpost = async (p, b, c) => (await post(p, b, c)).json()

// ---- enrollment ----
const owner = cookieOf(await post('/api/signup', { email: `own-${run}@t.local`, password: 'hunter22' }))
const commenter = cookieOf(await post('/api/signup', { email: `com-${run}@t.local`, password: 'hunter22' }))
const editor = cookieOf(await post('/api/signup', { email: `edi-${run}@t.local`, password: 'hunter22' }))

const { id: docId } = await jpost('/api/docs', { title: 'role test' }, owner)
await post(`/api/docs/${docId}/open`, {}, owner)

const { token } = await jpost(`/api/docs/${docId}/review-link`, {}, owner)
ok(!!token && !token.includes(docId), 'review key exists and does not carry the doc id')
const { token: again } = await jpost(`/api/docs/${docId}/review-link`, {}, owner)
ok(again === token, 'the door is minted once')

const rm = await jpost(`/api/review/${token}/open`, {}, commenter)
ok(rm.id === docId && rm.role === 'commenter', 'review door enrolls a commenter')
const rm2 = await jpost(`/api/review/${token}/open`, {}, commenter)
ok(rm2.role === 'commenter', 'the review door never promotes')

await post(`/api/docs/${docId}/open`, {}, editor)
const em = await jpost(`/api/review/${token}/open`, {}, editor)
ok(em.role === 'editor', 'the review door does not demote an editor')
const owm = await jpost(`/api/review/${token}/open`, {}, owner)
ok(owm.role === 'owner', 'the review door does not demote the owner')

// ---- writing surfaces refuse the commenter ----
const html = await raw('POST', `/api/docs/${docId}/html`, { html: '<p>graffiti</p>' }, commenter)
ok(html.status === 403, 'html snapshot refuses a commenter')
const vers = await raw('POST', `/api/docs/${docId}/versions`, { name: 'x', content: { type: 'doc' } }, commenter)
ok(vers.status === 403, 'versions refuse a commenter')
const vlist = await raw('GET', `/api/docs/${docId}/versions`, undefined, commenter)
ok(vlist.status === 403, "the page's past is not the reviewer's to read")
const mint = await raw('POST', `/api/docs/${docId}/review-link`, {}, commenter)
ok(mint.status === 403, 'a commenter cannot mint keys')

// ---- the margin stays open ----
await post(`/api/docs/${docId}/comments`, { id: `c_r${run}`, text: '', suggestion: 'their words', quote: 'q' }, commenter)
const rs = await raw('POST', `/api/comments/c_r${run}/resolve`, { outcome: 'accepted' }, commenter)
ok(rs.status === 403, 'a commenter cannot settle threads')
const settle = await raw('POST', `/api/comments/c_r${run}/resolve`, { outcome: 'accepted' }, owner)
ok(settle.status === 200, 'the owner settles the commenter suggestion')

// ---- the yjs wire ----
const MESSAGE_SYNC = 0
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSBASE}/ws/${docId}`, { headers: { Cookie: cookie, Origin: BASE } })
    ws.binaryType = 'arraybuffer'
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}
function readState(cookie) {
  return new Promise(async (resolve, reject) => {
    const ws = await connect(cookie)
    const ydoc = new Y.Doc()
    const t = setTimeout(() => {
      ws.close()
      resolve(ydoc)
    }, 1500)
    ws.on('message', (data) => {
      try {
        const dec = decoding.createDecoder(new Uint8Array(data))
        if (decoding.readVarUint(dec) !== MESSAGE_SYNC) return
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(dec, enc, ydoc, null)
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
      } catch (e) {
        clearTimeout(t)
        reject(e)
      }
    })
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, ydoc)
    ws.send(encoding.toUint8Array(enc))
  })
}
async function pushUpdate(cookie, key, value) {
  const ws = await connect(cookie)
  const mine = new Y.Doc()
  mine.getMap('meta').set(key, value)
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MESSAGE_SYNC)
  syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(mine))
  ws.send(encoding.toUint8Array(enc))
  await new Promise((r) => setTimeout(r, 600))
  ws.close()
}

await pushUpdate(owner, 'from-owner', 'yes')
await pushUpdate(commenter, 'from-commenter', 'no')
const state = await readState(owner)
ok(state.getMap('meta').get('from-owner') === 'yes', "an editor's update lands")
ok(state.getMap('meta').get('from-commenter') === undefined, "a commenter's update falls to the floor")
const seen = await readState(commenter)
ok(seen.getMap('meta').get('from-owner') === 'yes', 'a commenter still reads the page')

// ---- the writing door promotes ----
const pm = await jpost(`/api/docs/${docId}/open`, {}, commenter)
ok(pm.role === 'editor' && pm.promoted === true, 'the writing door grants the pen')
const html2 = await raw('POST', `/api/docs/${docId}/html`, { html: '<p>now mine to write</p>' }, commenter)
ok(html2.status === 200, 'a promoted pen writes')
await pushUpdate(commenter, 'from-promoted', 'yes')
const state2 = await readState(owner)
ok(state2.getMap('meta').get('from-promoted') === 'yes', "a promoted pen's socket lands updates")
const pm2 = await jpost(`/api/docs/${docId}/open`, {}, commenter)
ok(pm2.promoted === false, 'promotion announces itself only once')

process.exit(failed)

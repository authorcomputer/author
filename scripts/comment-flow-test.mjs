// The review loop, server-side: owner writes, a ghost (friend with the
// link, no account) comments, owner lists and resolves.
const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const run = Date.now().toString(36)

const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res
}

// the owner takes a desk and writes
const owner = await post('/api/signup', {
  email: `owner-${run}@test.local`,
  password: 'hunter22',
})
const ownerCookie = cookieOf(owner)
const { id: docId } = await (await post('/api/docs', { title: 'draft for review' }, ownerCookie)).json()

// a friend opens the link with no account — a ghost session
const ghost = await post('/api/auth/sign-in/anonymous', {})
const ghostCookie = cookieOf(ghost)

// the ghost leaves a comment
const cid = 'c_smoketest' + run
await post(`/api/docs/${docId}/comments`, { id: cid, text: 'this bit sings, but the ending drags', quote: 'the ending' }, ghostCookie)

// the owner sees it
const list = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
const c = list.find((x) => x.id === cid)
if (!c) throw new Error('FAIL: comment not visible to owner')
if (c.resolved) throw new Error('FAIL: comment born resolved')
console.log(`PASS: ghost comment visible to owner (by ${c.username})`)

// and resolves it
await post(`/api/comments/${cid}/resolve`, {}, ownerCookie)
const after = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
if (!after.find((x) => x.id === cid)?.resolved) throw new Error('FAIL: resolve did not stick')
console.log('PASS: resolve sticks')

// the ghost suggests an edit — proposed words, no note required
const sid = 'c_suggtest' + run
await post(
  `/api/docs/${docId}/comments`,
  { id: sid, text: '', suggestion: 'the ending lands', quote: 'the ending drags' },
  ghostCookie
)
const withSugg = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
const s = withSugg.find((x) => x.id === sid)
if (!s || s.suggestion !== 'the ending lands') throw new Error('FAIL: suggestion not stored')
console.log('PASS: suggested edit round-trips')

// applying replaces the passage with exactly what was stored, so an edit
// at the ceiling must survive whole — and one over it must be refused
// with words, never quietly cut mid-sentence
const big = 'y'.repeat(5000)
const bid = 'c_bigsugg' + run
await post(`/api/docs/${docId}/comments`, { id: bid, text: '', suggestion: big, quote: 'the ending' }, ghostCookie)
const withCeiling = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
if (withCeiling.find((x) => x.id === bid)?.suggestion !== big)
  throw new Error('FAIL: suggestion at the ceiling came back cut')
console.log('PASS: an edit at the ceiling survives whole')
const over = await fetch(`${BASE}/api/docs/${docId}/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ghostCookie },
  body: JSON.stringify({ text: '', suggestion: 'y'.repeat(5001), quote: 'the ending' }),
})
if (over.status !== 400)
  throw new Error(`FAIL: oversized edit accepted (${over.status}) — it would be applied truncated`)
console.log('PASS: over-long edits are refused, never silently cut')

// the owner replies to the suggestion — a thread
await post(`/api/docs/${docId}/comments`, { text: 'ha, fair — applying', parent_id: sid }, ownerCookie)
const withReply = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
const reply = withReply.find((x) => x.parent_id === sid)
if (!reply || reply.text !== 'ha, fair — applying') throw new Error('FAIL: reply not threaded')
console.log('PASS: replies thread under their parent')

// one level only — a reply can't parent another reply
const nested = await fetch(`${BASE}/api/docs/${docId}/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ownerCookie },
  body: JSON.stringify({ text: 'deeper still', parent_id: reply.id }),
})
if (nested.status !== 400) throw new Error('FAIL: nested reply accepted')
console.log('PASS: nested replies refused')

// and settled threads take no more replies
await post(`/api/comments/${sid}/resolve`, {}, ownerCookie)
const late = await fetch(`${BASE}/api/docs/${docId}/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ghostCookie },
  body: JSON.stringify({ text: 'one more thing', parent_id: sid }),
})
if (late.status !== 400) throw new Error('FAIL: reply to settled thread accepted')
console.log('PASS: settled threads take no more replies')

// a reply to a thread that isn't there is refused
const orphan = await fetch(`${BASE}/api/docs/${docId}/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ownerCookie },
  body: JSON.stringify({ text: 'hello?', parent_id: 'c_nowhere' }),
})
if (orphan.status !== 400) throw new Error('FAIL: orphan reply accepted')
console.log('PASS: orphan replies refused')

// neither a note nor an edit is nothing
const empty = await fetch(`${BASE}/api/docs/${docId}/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ghostCookie },
  body: JSON.stringify({ text: '', suggestion: '  ', quote: 'x' }),
})
if (empty.status !== 400) throw new Error('FAIL: empty comment accepted')
console.log('PASS: empty comments refused')

// settling is a doc-level act — a stranger holding a cid gets nothing
const tid = 'c_authtest' + run
await post(`/api/docs/${docId}/comments`, { id: tid, text: 'still open', quote: 'x' }, ownerCookie)
const stranger = await post('/api/signup', {
  email: `stranger-${run}@test.local`,
  password: 'hunter22',
})
const strangerCookie = cookieOf(stranger)
const theft = await fetch(`${BASE}/api/comments/${tid}/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: strangerCookie },
  body: '{}',
})
if (theft.status !== 403) throw new Error(`FAIL: stranger resolved a thread on a doc they never touched (${theft.status})`)
const still = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
if (still.find((x) => x.id === tid)?.resolved) throw new Error('FAIL: stranger resolve stuck anyway')
console.log('PASS: a stranger cannot settle another doc’s thread')

// a cid that names no comment is a miss, not a silent ok
const miss = await fetch(`${BASE}/api/comments/c_nowhere${run}/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: ownerCookie },
  body: '{}',
})
if (miss.status !== 404) throw new Error(`FAIL: resolving nothing returned ${miss.status}`)
console.log('PASS: resolving nothing is a 404')

// but a collaborator — someone who opened the doc — may settle threads
await post(`/api/docs/${docId}/open`, {}, ghostCookie)
await post(`/api/comments/${tid}/resolve`, {}, ghostCookie)
const settled = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
if (!settled.find((x) => x.id === tid)?.resolved) throw new Error('FAIL: collaborator resolve refused')
console.log('PASS: a collaborator may settle a thread')
process.exit(0)

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
const owner = await post('/api/auth/sign-up/email', {
  email: `owner-${run}@test.local`,
  password: 'hunter22',
  name: `owner${run}`,
  username: `owner${run}`,
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

// the owner replies to the suggestion — a thread
await post(`/api/docs/${docId}/comments`, { text: 'ha, fair — applying', parent_id: sid }, ownerCookie)
const withReply = await (
  await fetch(`${BASE}/api/docs/${docId}/comments`, { headers: { Cookie: ownerCookie } })
).json()
const reply = withReply.find((x) => x.parent_id === sid)
if (!reply || reply.text !== 'ha, fair — applying') throw new Error('FAIL: reply not threaded')
console.log('PASS: replies thread under their parent')

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
process.exit(0)

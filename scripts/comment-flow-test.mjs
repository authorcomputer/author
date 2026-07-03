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
process.exit(0)

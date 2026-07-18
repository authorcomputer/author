// event log e2e: comments/suggestions/resolves/version saves append history,
// unseen counts follow the reader's cursor, open and seen advance it
const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const run = Date.now().toString(36)
let failed = 0

const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failed = 1
}
const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')

async function req(method, path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res
}
const post = (p, b, c) => req('POST', p, b, c)
const get = async (p, c) => (await req('GET', p, undefined, c)).json()

// owner takes a desk, writes a page
const owner = cookieOf(await post('/api/signup', { email: `o-${run}@t.local`, password: 'hunter22' }))
const { id: docId } = await (await post('/api/docs', { title: 'events draft' }, owner)).json()
await post(`/api/docs/${docId}/open`, {}, owner)

// reviewer arrives, opens (cursor starts at the end), then reviews
const rev = cookieOf(await post('/api/signup', { email: `r-${run}@t.local`, password: 'hunter22' }))
await post(`/api/docs/${docId}/open`, {}, rev)
await post(`/api/docs/${docId}/comments`, { text: 'a note', quote: 'q' }, rev)
await post(
  `/api/docs/${docId}/comments`,
  { text: 'why', suggestion: 'better words', quote: 'old words' },
  rev
)

// the owner's desk shows the news
let docs = await get('/api/docs', owner)
let row = docs.find((d) => d.id === docId)
ok(row?.unseen?.['comment.add'] === 1, 'desk shows the new comment')
ok(row?.unseen?.['suggestion.add'] === 1, 'desk shows the new suggested edit')

// the reviewer's own doings are not news to them
docs = await get('/api/docs', rev)
row = docs.find((d) => d.id === docId)
ok(!row.unseen, 'your own pen is not news')

// history reads newest first, with the words attached
const events = await get(`/api/docs/${docId}/events`, owner)
ok(events.length === 2, 'two entries in the log')
ok(events[0].type === 'suggestion.add' && events[0].detail === 'better words', 'newest first, words kept')
ok(events[1].type === 'comment.add' && events[1].detail === 'a note', 'the note beneath it')

// opening the page reads the news
await post(`/api/docs/${docId}/open`, {}, owner)
docs = await get('/api/docs', owner)
ok(!docs.find((d) => d.id === docId).unseen, 'opening clears the desk badge')

// the owner settles the note — news for the reviewer now
const comments = await get(`/api/docs/${docId}/comments`, owner)
const note = comments.find((c) => !c.suggestion)
await post(`/api/comments/${note.id}/resolve`, {}, owner)
await post(`/api/docs/${docId}/versions`, { name: 'draft two', content: { type: 'doc' } }, owner)
docs = await get('/api/docs', rev)
row = docs.find((d) => d.id === docId)
ok(row?.unseen?.['comment.resolve'] === 1, 'reviewer sees the thread settled')
ok(row?.unseen?.['version.save'] === 1, 'reviewer sees the kept version')

// seen advances the cursor without an open
await post(`/api/docs/${docId}/seen`, {}, rev)
docs = await get('/api/docs', rev)
ok(!docs.find((d) => d.id === docId).unseen, 'seen clears the badge')

const after = await get(`/api/docs/${docId}/events`, rev)
ok(after.length === 4, 'the log keeps everything')
ok(after[0].type === 'version.save' && after[0].detail === 'draft two', 'kept version wears its name')

process.exit(failed)

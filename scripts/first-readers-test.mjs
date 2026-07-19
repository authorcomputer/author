// first readers + rss e2e: the standing circle is kept per writer, the send
// button enrolls it through the review door (commenter, never editor), the
// desk row carries the review key for commenters, and a public profile
// speaks rss for exactly the pieces it lists.
const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
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
const jget = async (p, c) => (await req('GET', p, undefined, c)).json()

// ---- desks ----
const writer = cookieOf(await post('/api/signup', { email: `wr-${run}@t.local`, password: 'hunter22' }))
const reader1 = cookieOf(await post('/api/signup', { email: `r1-${run}@t.local`, password: 'hunter22' }))
const reader2 = cookieOf(await post('/api/signup', { email: `r2-${run}@t.local`, password: 'hunter22' }))
const stranger = cookieOf(await post('/api/signup', { email: `st-${run}@t.local`, password: 'hunter22' }))
const wme = await jget('/api/me', writer)
const r1me = await jget('/api/me', reader1)
const r2me = await jget('/api/me', reader2)

// ---- the circle ----
let c = await jpost('/api/first-readers', { handle: r1me.username.toUpperCase() }, writer)
ok(c.readers.length === 1 && c.readers[0].username === r1me.username, 'a handle joins the circle, case put aside')
c = await jpost('/api/first-readers', { handle: r2me.username }, writer)
ok(c.readers.length === 2, 'the circle holds two')
c = await jpost('/api/first-readers', { handle: r1me.username }, writer)
ok(c.readers.length === 2, 'adding a reader twice keeps one of them')
ok((await raw('POST', '/api/first-readers', { handle: wme.username }, writer)).status === 400, 'your own handle is refused')
ok((await raw('POST', '/api/first-readers', { handle: 'no-such-desk-xyz' }, writer)).status === 404, 'an unknown handle is refused')
ok((await jget('/api/first-readers', writer)).readers.length === 2, 'the circle reads back')

// ---- the send ----
const { id: docId } = await jpost('/api/docs', { title: 'early pages' }, writer)
await post(`/api/docs/${docId}/open`, {}, writer)
const s1 = await jpost(`/api/docs/${docId}/send`, {}, writer)
ok(s1.sent === 2 && s1.circle === 2, 'a send enrolls the whole circle')
const { token } = await jpost(`/api/docs/${docId}/review-link`, {}, writer)
ok(!!token, 'the send minted the review door')

const r1docs = await jget('/api/docs', reader1)
const row = r1docs.find((d) => d.id === docId)
ok(!!row && row.role === 'commenter', 'the doc lands on the reader’s desk as a commenter')
ok(row.review_token === token, 'the desk row wears the review key')
ok(!row.mine && (row.unseen?.send || 0) > 0, 'the delivery is news to the reader')
const wrow = (await jget('/api/docs', writer)).find((d) => d.id === docId)
ok(wrow.role === 'owner' && wrow.review_token === null, 'the owner’s row carries no review key')

const opened = await jpost(`/api/review/${token}/open`, {}, reader1)
ok(opened.id === docId && opened.role === 'commenter', 'the review door knows the enrolled reader')

const evs = await jget(`/api/docs/${docId}/events`, writer)
const sends = evs.filter((e) => e.type === 'send')
ok(sends.length === 1 && sends[0].detail === 'to 2 first readers', 'one history line per delivery')
const s2 = await jpost(`/api/docs/${docId}/send`, {}, writer)
ok(s2.sent === 0, 'a re-send to an enrolled circle is a quiet no-op')
ok((await jget(`/api/docs/${docId}/events`, writer)).filter((e) => e.type === 'send').length === 1, 'and writes no second line')

ok((await raw('POST', `/api/docs/${docId}/send`, {}, reader1)).status === 403, 'a commenter cannot send')
ok((await raw('POST', `/api/docs/${docId}/send`, {}, stranger)).status === 403, 'a stranger cannot send')

c = await (await req('DELETE', `/api/first-readers/${r1me.id}`, undefined, writer)).json()
ok(c.readers.length === 1, 'a reader can be let go')

// ---- rss ----
await post(`/api/docs/${docId}/html`, { html: '<p>the opening lines</p>' }, writer)
await post(`/api/docs/${docId}/publish`, { publish: true, html: '<p>the opening lines</p>' }, writer)
const { slug } = await jget(`/api/docs/${docId}`, writer)
ok((await raw('GET', `/u/${wme.username}/feed.xml`)).status === 404, 'a private profile has no feed')
await post('/api/settings', { profile_public: true, links: [] }, writer)
const feedRes = await raw('GET', `/u/${wme.username}/feed.xml`)
const feed = await feedRes.text()
ok(feedRes.status === 200 && feedRes.headers.get('content-type')?.includes('rss'), 'a public profile speaks rss')
ok(feed.includes('early pages') && feed.includes(`/p/${slug}`) && feed.includes('the opening lines'), 'the feed carries the piece, its address, and its words')
await post(`/api/docs/${docId}/profile`, { show: false }, writer)
ok(!(await (await raw('GET', `/u/${wme.username}/feed.xml`)).text()).includes(`/p/${slug}`), 'an unlisted piece leaves the feed')
ok((await raw('GET', '/u/no-such-desk-xyz/feed.xml')).status === 404, 'an unknown handle has no feed')

process.exit(failed)

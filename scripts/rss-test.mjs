// rss + the commenter's desk, e2e: a public profile speaks rss for exactly
// the pieces it lists, and a desk row enrolled through the review door
// carries the review key, never the writing one.
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

const writer = cookieOf(await post('/api/signup', { email: `rw-${run}@t.local`, password: 'hunter22' }))
const reader = cookieOf(await post('/api/signup', { email: `rr-${run}@t.local`, password: 'hunter22' }))
const wme = await jget('/api/me', writer)

// ---- the commenter's desk row ----
const { id: docId } = await jpost('/api/docs', { title: 'early pages' }, writer)
await post(`/api/docs/${docId}/open`, {}, writer)
const { token } = await jpost(`/api/docs/${docId}/review-link`, {}, writer)
const opened = await jpost(`/api/review/${token}/open`, {}, reader)
ok(opened.id === docId && opened.role === 'commenter', 'the review door enrolls a commenter')
const row = (await jget('/api/docs', reader)).find((d) => d.id === docId)
ok(!!row && row.role === 'commenter' && row.review_token === token, 'their desk row wears the review key')
const wrow = (await jget('/api/docs', writer)).find((d) => d.id === docId)
ok(wrow.role === 'owner' && wrow.review_token === null, 'the owner’s row carries no review key')

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

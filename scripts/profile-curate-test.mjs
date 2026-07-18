// The profile as its own curation surface: the owner sees every published
// piece (listed or not, with ids — theirs already), visitors see only the
// listed ones and never a doc id, and a private profile opens for no one
// but its owner.
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
  return res.json()
}

const ownerRes = await raw('POST', '/api/signup', { email: `cur-${run}@t.local`, password: 'hunter22' })
const owner = cookieOf(ownerRes)
const { username } = await req('GET', '/api/me', undefined, owner)
const visitorRes = await raw('POST', '/api/signup', { email: `vis-${run}@t.local`, password: 'hunter22' })
const visitor = cookieOf(visitorRes)

// two published pieces: one listed, one not
const { id: d1 } = await req('POST', '/api/docs', { title: 'listed piece' }, owner)
const { id: d2 } = await req('POST', '/api/docs', { title: 'unlisted piece' }, owner)
await req('POST', `/api/docs/${d1}/publish`, { publish: true, html: '<p>one</p>' }, owner)
await req('POST', `/api/docs/${d2}/publish`, { publish: true, html: '<p>two</p>' }, owner)
await req('POST', `/api/docs/${d2}/profile`, { show: false }, owner)

// private: closed to visitors, open to the owner
const closed = await raw('GET', `/api/profile/${username}`, undefined, visitor)
ok(closed.status === 404, 'a private profile is closed to visitors')
const own = await req('GET', `/api/profile/${username}`, undefined, owner)
ok(own.own === true && own.profile_public === false, 'the owner sees their private profile')
ok(own.articles.length === 2, 'the owner sees listed and unlisted alike')
ok(
  own.articles.every((a) => typeof a.id === 'string' && typeof a.listed === 'boolean'),
  'own pieces carry id and listed'
)

// the settings door no longer speaks of the old master switch
const settings = await req('GET', '/api/settings', undefined, owner)
ok(!('show_writing' in settings), 'settings dropped the master switch')

// public: visitors see only what is listed, and never an id
await req('POST', '/api/settings', { profile_public: true, links: [] }, owner)
const pub = await req('GET', `/api/profile/${username}`, undefined, visitor)
ok(pub.articles.length === 1 && pub.articles[0].title === 'listed piece', 'visitors see only listed pieces')
ok(pub.articles.every((a) => !('id' in a)), 'no doc ids leave the house')
ok(!('own' in pub), 'a visitor is not the owner')

// curating from the profile: unlist the listed one, list the unlisted one
await req('POST', `/api/docs/${d1}/profile`, { show: false }, owner)
await req('POST', `/api/docs/${d2}/profile`, { show: true }, owner)
const after = await req('GET', `/api/profile/${username}`, undefined, visitor)
ok(
  after.articles.length === 1 && after.articles[0].title === 'unlisted piece',
  'listing follows the per-piece toggle'
)

process.exit(failed)

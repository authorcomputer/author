// The docs list must tell the truth about profile visibility. The settings
// checkbox on /u/you is drawn straight from GET /api/docs, so if that list
// drops on_profile the UI swears a live piece is unlisted — and the writer,
// believing it, leaves it public. Proves the list agrees with the single-doc
// meta (SELECT *) through every flip of the toggle.
const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const run = Date.now().toString(36)

const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json()
}
async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}
async function signup(name) {
  const res = await fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({
      email: `${name}-${run}@test.local`,
      password: 'hunter22',
    }),
  })
  if (!res.ok) throw new Error(`signup: ${res.status} ${await res.text()}`)
  return cookieOf(res)
}

// both readings of the same row must agree, or the checkbox lies
async function expectListed(cookie, docId, want, when) {
  const listed = (await get('/api/docs', cookie)).find((d) => d.id === docId)
  if (!listed) throw new Error(`FAIL: doc missing from /api/docs ${when}`)
  const meta = await get(`/api/docs/${docId}`, cookie)
  if (meta.on_profile !== want)
    throw new Error(`FAIL: doc meta says on_profile=${meta.on_profile} ${when}, wanted ${want}`)
  if (listed.on_profile !== want)
    throw new Error(
      `FAIL: /api/docs says on_profile=${listed.on_profile} ${when}, but the doc itself says ${want}`
    )
}

const cookie = await signup('ink')
const { id: docId } = await post('/api/docs', { title: 'profile list test' }, cookie)

// a fresh doc defaults to listed (db.js: on_profile INTEGER DEFAULT 1)
await expectListed(cookie, docId, true, 'on a fresh doc')
console.log('PASS: fresh doc reports on_profile=true in the list')

// hide it, and the list must say so
await post(`/api/docs/${docId}/profile`, { show: false }, cookie)
await expectListed(cookie, docId, false, 'after hiding')
console.log('PASS: hidden doc reports on_profile=false in the list')

// show it again, and the list must follow
await post(`/api/docs/${docId}/profile`, { show: true }, cookie)
await expectListed(cookie, docId, true, 'after re-listing')
console.log('PASS: re-listed doc reports on_profile=true in the list')

console.log('ALL PASS')
process.exit(0)

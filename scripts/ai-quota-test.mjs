// The ledger only counts answers. Boot the server with a bogus
// ANTHROPIC_API_KEY and AI_FREE_MONTHLY=2 — every model call fails before
// any ink, and none of them may burn the writer's allowance.
const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const run = Date.now().toString(36)

const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')

async function post(path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}

// a free writer takes a desk — no membership, capped at AI_FREE_MONTHLY
const writer = await post('/api/auth/sign-up/email', {
  email: `quota-${run}@test.local`,
  password: 'hunter22',
  name: `quota${run}`,
  username: `quota${run}`,
})
if (!writer.ok) throw new Error(`sign-up: ${writer.status} ${await writer.text()}`)
const writerCookie = cookieOf(writer)

// three asks against a cap of two — if failed calls were charged, the third
// would be refused with membership_required despite zero usable output
for (let i = 1; i <= 3; i++) {
  const res = await post('/api/ai/feedback', { text: 'a draft about nothing much at all' }, writerCookie)
  const body = await res.text()
  if (res.status === 403) throw new Error(`FAIL: ask ${i} refused (${body}) — a failed call was charged`)
  if (!body.includes('[ai error')) throw new Error(`FAIL: ask ${i} expected a provider failure, got: ${body.slice(0, 120)}`)
}
console.log('PASS: provider failures leave the free monthly count untouched')

// same promise for checks — the 500 path must not charge either
for (let i = 1; i <= 3; i++) {
  const res = await post('/api/ai/checks', { text: 'stil here', checks: ['grammar'] }, writerCookie)
  if (res.status === 403) throw new Error(`FAIL: checks ask ${i} refused — a failed call was charged`)
  if (res.status !== 500) throw new Error(`FAIL: checks ask ${i} expected 500, got ${res.status}`)
}
console.log('PASS: failed checks leave the free monthly count untouched')

// a ghost gets exactly one on the house — a provider failure must not be it
const ghost = await post('/api/auth/sign-in/anonymous', {})
if (!ghost.ok) throw new Error(`ghost sign-in: ${ghost.status}`)
const ghostCookie = cookieOf(ghost)
for (let i = 1; i <= 2; i++) {
  const res = await post('/api/ai/feedback', { text: 'a ghost of a draft' }, ghostCookie)
  const body = await res.text()
  if (res.status === 403) throw new Error(`FAIL: ghost ask ${i} refused (${body}) — a failed call was charged`)
  if (!body.includes('[ai error')) throw new Error(`FAIL: ghost ask ${i} expected a provider failure, got: ${body.slice(0, 120)}`)
}
console.log('PASS: a provider failure does not spend the ghost’s one free request')

// and a request with nothing to read is still refused before any ledger talk
const blank = await post('/api/ai/feedback', { text: '   ' }, writerCookie)
if (blank.status !== 400) throw new Error(`FAIL: blank ask expected 400, got ${blank.status}`)
console.log('PASS: empty asks still refused up front')
process.exit(0)

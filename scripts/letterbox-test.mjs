// letterbox e2e, dry post office (no RESEND_API_KEY): the slot answers flat
// no matter what, double opt-in walks through the logged confirm link, the
// ledger settles per writer and globally, a piece posts once, and the caps
// refuse before a single letter could cost money. needs AUTHOR_SERVER_LOG
// pointing at the booted server's log to harvest the dry-run links.
import fs from 'node:fs'

const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const LOG = process.env.AUTHOR_SERVER_LOG
const run = Date.now().toString(36)
let failed = 0
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failed = 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
async function raw(method, path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
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
// dry-run links for one address, in the order they were logged
const linksFor = (addr) =>
  fs
    .readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((l) => l.includes('email (dry)') && l.includes(`to=${addr}`))
    .map((l) => l.match(/link=(\S+)/)?.[1])
    .filter(Boolean)

// ---- desks ----
const w1 = cookieOf(await post('/api/signup', { email: `lb1-${run}@t.local`, password: 'hunter22' }))
const w2 = cookieOf(await post('/api/signup', { email: `lb2-${run}@t.local`, password: 'hunter22' }))
const stranger = cookieOf(await post('/api/signup', { email: `lb3-${run}@t.local`, password: 'hunter22' }))
const w1me = await jget('/api/me', w1)
const w2me = await jget('/api/me', w2)
const sub1 = `s1-${run}@t.local`
const sub2 = `s2-${run}@t.local`
const sub3 = `s3-${run}@t.local`

// ---- the slot answers flat ----
const closed = await (await raw('POST', `/api/letterbox/${w1me.username}/subscribe`, { email: sub1 })).json()
const nobody = await (await raw('POST', '/api/letterbox/no-such-desk-xyz/subscribe', { email: sub1 })).json()
ok(JSON.stringify(closed) === JSON.stringify(nobody), 'a closed letterbox and no letterbox answer alike')
await sleep(300)
ok((await jget('/api/letterbox', w1)).subscribers.length === 0, 'a closed slot keeps nothing')

// ---- open, drop, confirm ----
let box = await jpost('/api/letterbox', { on: true }, w1)
ok(box.on === true, 'the letterbox opens')
await post(`/api/letterbox/${w1me.username}/subscribe`, { email: sub1 })
await sleep(300)
ok(linksFor(sub1).length === 1, 'a dropped address is asked to confirm')
await post(`/api/letterbox/${w1me.username}/subscribe`, { email: sub1 })
await sleep(300)
ok(linksFor(sub1).length === 1, 'asking again inside ten minutes stays quiet')
box = await jget('/api/letterbox', w1)
ok(box.subscribers.length === 1 && !box.subscribers[0].confirmed, 'the owner sees the waiting address')

const confirmUrl = linksFor(sub1)[0]
const c0 = await fetch(confirmUrl)
ok(c0.ok && (await c0.text()).includes('<form'), 'the confirm link is a question, not a deed')
ok((await jget('/api/letterbox', w1)).subscribers[0].confirmed === false, 'a prefetch confirms no one')
const c1 = await fetch(confirmUrl, { method: 'POST' })
ok(c1.ok && (await c1.text()).includes('letterbox'), 'the click confirms')
ok((await jget('/api/letterbox', w1)).subscribers[0].confirmed === true, 'the address is confirmed')
const c2 = await fetch(confirmUrl)
ok(c2.ok && (await c2.text()).includes('already'), 'a second visit hears "already in", not a blank door')

await post(`/api/letterbox/${w1me.username}/subscribe`, { email: sub2 })
await sleep(300)
await fetch(linksFor(sub2)[0], { method: 'POST' })
await post(`/api/letterbox/${w1me.username}/subscribe`, { email: sub3 })
await sleep(300)
box = await jget('/api/letterbox', w1)
ok(box.subscribers.length === 2, 'a full letterbox takes no more addresses')

// ---- the post ----
const { id: d1 } = await jpost('/api/docs', { title: 'letter one' }, w1)
ok((await raw('POST', `/api/docs/${d1}/post`, {}, w1)).status === 400, 'an unpublished piece cannot post')
await post(`/api/docs/${d1}/publish`, { publish: true, html: '<p>dear readers</p>' }, w1)
const pub = await jget(`/api/public/${(await jget(`/api/docs/${d1}`, w1)).slug}`)
ok(pub.letterbox === true, 'the published page knows the letterbox is open')
ok((await raw('POST', `/api/docs/${d1}/post`, {}, stranger)).status === 403, 'a stranger cannot post')
const p1 = await jpost(`/api/docs/${d1}/post`, {}, w1)
ok(p1.posted === 2, 'the piece goes to every confirmed address')
ok(!!(await jget(`/api/docs/${d1}`, w1)).posted_at, 'the piece wears its post stamp')
ok((await raw('POST', `/api/docs/${d1}/post`, {}, w1)).status === 400, 'a piece posts once')
const evs = await jget(`/api/docs/${d1}/events`, w1)
ok(evs.some((e) => e.type === 'post' && e.detail === 'to 2 addresses'), 'the post is one line of history')

// ---- postage (booted with EMAILS_FREE_MONTHLY=4) ----
ok((await jget('/api/letterbox', w1)).postage.used === 2, 'the ledger charged what left')
const { id: d2 } = await jpost('/api/docs', { title: 'letter two' }, w1)
await post(`/api/docs/${d2}/publish`, { publish: true, html: '<p>again</p>' }, w1)
ok((await jpost(`/api/docs/${d2}/post`, {}, w1)).posted === 2, 'postage covers a second letter')
const { id: d3 } = await jpost('/api/docs', { title: 'letter three' }, w1)
await post(`/api/docs/${d3}/publish`, { publish: true, html: '<p>thrice</p>' }, w1)
ok((await raw('POST', `/api/docs/${d3}/post`, {}, w1)).status === 429, 'past the month’s postage, the post refuses')

// ---- leaving ----
const leaveUrl = (fs.readFileSync(LOG, 'utf8').match(new RegExp(`${BASE}/letter/leave/[a-f0-9]+`, 'g')) || [])[0]
ok(!!leaveUrl, 'every letter carries a way out')
await fetch(leaveUrl)
ok((await jget('/api/letterbox', w1)).subscribers.filter((s) => s.confirmed).length === 2, 'a prefetch ushers no one out')
await fetch(leaveUrl, { method: 'POST' })
ok((await jget('/api/letterbox', w1)).subscribers.filter((s) => s.confirmed).length === 1, 'the click lets an address out')
ok((await fetch(leaveUrl, { method: 'POST' })).status === 404, 'a spent leave token opens nothing')

// ---- one address, many letterboxes (booted with EMAILS_PER_ADDRESS_DAILY=1) ----
await jpost('/api/letterbox', { on: true }, w2)
await post(`/api/letterbox/${w2me.username}/subscribe`, { email: sub1 })
await sleep(300)
ok(
  linksFor(sub1).filter((l) => l.includes('/letter/confirm/')).length === 1,
  'one address is asked only so often in a day, across every letterbox'
)

// ---- the global ceiling (booted with EMAILS_GLOBAL_DAILY=7) ----
// spent so far: 2 confirms + 4 letters = 6; the 7th fits, the 8th must not
const s21 = `s21-${run}@t.local`
const s22 = `s22-${run}@t.local`
await post(`/api/letterbox/${w2me.username}/subscribe`, { email: s21 })
await sleep(300)
ok(linksFor(s21).length === 1, 'the last of the day’s room still posts')
await fetch(linksFor(s21)[0], { method: 'POST' })
await post(`/api/letterbox/${w2me.username}/subscribe`, { email: s22 })
await sleep(300)
ok(linksFor(s22).length === 0, 'past the ceiling, not even a confirmation leaves')
const { id: d4 } = await jpost('/api/docs', { title: 'over the top' }, w2)
await post(`/api/docs/${d4}/publish`, { publish: true, html: '<p>no room</p>' }, w2)
ok((await raw('POST', `/api/docs/${d4}/post`, {}, w2)).status === 503, 'past the ceiling, the post office refuses')
process.exit(failed)

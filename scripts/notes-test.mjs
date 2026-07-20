// notes e2e: quick slips are private to their desk — created, edited,
// listed newest-first, tossed; a stranger's guess and a missing note answer
// alike; ghosts are nudged to take a desk.
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

const owner = cookieOf(await post('/api/signup', { email: `nt1-${run}@t.local`, password: 'hunter22' }))
const stranger = cookieOf(await post('/api/signup', { email: `nt2-${run}@t.local`, password: 'hunter22' }))
const ghost = cookieOf(await post('/api/auth/sign-in/anonymous', {}))

// ---- keeping is for desks ----
const g = await raw('POST', '/api/notes', {}, ghost)
ok(g.status === 403 && (await g.json()).code === 'account_required', 'a ghost is nudged to take a desk')

// ---- the slips ----
const { id: n1 } = await jpost('/api/notes', { text: 'first thought' }, owner)
await new Promise((r) => setTimeout(r, 5))
const { id: n2 } = await jpost('/api/notes', {}, owner)
await post(`/api/notes/${n2}`, { text: 'second thought, refined', title: 'the second' }, owner)
let list = await jget('/api/notes', owner)
ok(list.length === 2, 'the corner holds both slips')
ok(list[0].id === n2 && list[0].title === 'the second', 'the freshest slip sits on top, wearing its title')
ok(list.find((n) => n.id === n1)?.text === 'first thought', 'a slip keeps its words')

// ---- privacy ----
ok((await jget('/api/notes', stranger)).length === 0, 'a stranger sees an empty corner')
ok((await raw('POST', `/api/notes/${n1}`, { text: 'graffiti' }, stranger)).status === 404, 'a stranger cannot write on another desk’s slip')
await req('DELETE', `/api/notes/${n1}`, undefined, stranger)
ok((await jget('/api/notes', owner)).length === 2, 'a stranger’s toss removes nothing')

// ---- the toss ----
await req('DELETE', `/api/notes/${n1}`, undefined, owner)
list = await jget('/api/notes', owner)
ok(list.length === 1 && list[0].id === n2, 'a tossed slip is gone')

process.exit(failed)

// outcomes e2e: accepted / rejected / resolved are distinct, attributed, logged
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
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res
}
const post = (p, b, c) => req('POST', p, b, c)
const get = async (p, c) => (await req('GET', p, undefined, c)).json()

const owner = cookieOf(await post('/api/signup', { email: `ow-${run}@t.local`, password: 'hunter22' }))
const rev = cookieOf(await post('/api/signup', { email: `rv-${run}@t.local`, password: 'hunter22' }))
const { id: docId } = await (await post('/api/docs', { title: 'outcomes' }, owner)).json()
await post(`/api/docs/${docId}/open`, {}, rev)

// three threads: an edit to accept, an edit to dismiss, a note to resolve
await post(`/api/docs/${docId}/comments`, { id: 'c_take_'+run, text: '', suggestion: 'take me', quote: 'a' }, rev)
await post(`/api/docs/${docId}/comments`, { id: 'c_toss_'+run, text: '', suggestion: 'toss me', quote: 'b' }, rev)
await post(`/api/docs/${docId}/comments`, { id: 'c_note_'+run, text: 'just a note', quote: 'c' }, rev)

await post('/api/comments/c_take_'+run+'/resolve', { outcome: 'accepted' }, owner)
await post('/api/comments/c_toss_'+run+'/resolve', { outcome: 'rejected' }, owner)
await post('/api/comments/c_note_'+run+'/resolve', { outcome: 'accepted' }, owner) // a note can't be "accepted"

const cs = await get(`/api/docs/${docId}/comments`, rev)
const by = (id) => cs.find((c) => c.id === id)
ok(by('c_take_'+run).outcome === 'accepted' && by('c_take_'+run).resolved_by, 'accepted edit remembers who took it')
ok(by('c_toss_'+run).outcome === 'rejected', 'dismissed edit says so')
ok(by('c_note_'+run).outcome === 'resolved', 'a note only resolves, whatever the client claims')

const evs = await get(`/api/docs/${docId}/events`, rev)
const types = evs.map((e) => e.type)
ok(types.includes('suggestion.accept'), 'history logs the acceptance')
ok(types.includes('suggestion.reject'), 'history logs the dismissal')
ok(types.includes('comment.resolve'), 'history logs the settled note')
ok(evs.find((e) => e.type === 'suggestion.accept').detail === 'take me', 'acceptance keeps the words')

// the desk folds them into settled news for the reviewer
const docs = await get('/api/docs', rev)
const row = docs.find((d) => d.id === docId)
ok(
  (row.unseen?.['suggestion.accept'] || 0) === 1 &&
    (row.unseen?.['suggestion.reject'] || 0) === 1 &&
    (row.unseen?.['comment.resolve'] || 0) === 1,
  'reviewer sees all three settlements as news'
)
process.exit(failed)

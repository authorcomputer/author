// the machine door, e2e: keys mint once and revoke forever, the mcp door
// answers only to a bearer key, tools see exactly one desk, and a draft a
// machine starts opens as a real page.
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

let rpcId = 0
async function mcp(token, method, params, expectStatus) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  if (expectStatus) return res.status
  const body = await res.json()
  if (body.error) throw new Error(`mcp ${method}: ${JSON.stringify(body.error)}`)
  return body.result
}
const toolText = (r) => JSON.parse(r.content[0].text)
const INIT = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'test', version: '0' },
}

// ---- desks and keys ----
const alice = cookieOf(await post('/api/signup', { email: `mc1-${run}@t.local`, password: 'hunter22' }))
const bob = cookieOf(await post('/api/signup', { email: `mc2-${run}@t.local`, password: 'hunter22' }))
const { token: aKey } = await jpost('/api/tokens', { label: 'test rig' }, alice)
ok(aKey.startsWith('author_'), 'a key is minted, wearing its prefix')
ok((await jget('/api/tokens', alice)).tokens.length === 1, 'the key is listed, the secret is not')
const { token: bKey } = await jpost('/api/tokens', {}, bob)

// ---- the door ----
ok((await mcp(null, 'initialize', INIT, true)) === 401, 'no key, no door')
ok((await mcp('author_' + '0'.repeat(48), 'initialize', INIT, true)) === 401, 'a guessed key opens nothing')
const init = await mcp(aKey, 'initialize', INIT)
ok(init.serverInfo?.name === 'author', 'the door introduces itself')
const tools = (await mcp(aKey, 'tools/list', {})).tools
ok(tools.length === 4 && tools.map((t) => t.name).sort().join(',') === 'create_draft,list_drafts,read_comments,read_draft', 'four tools, no more')

// ---- a machine starts a page ----
const made = toolText(
  await mcp(aKey, 'tools/call', {
    name: 'create_draft',
    arguments: { title: 'from the wire', text: 'first line\n\nsecond thought' },
  })
)
ok(!!made.id && made.editor_url.includes(made.id), 'a draft is minted from plain text')
const list = toolText(await mcp(aKey, 'tools/call', { name: 'list_drafts', arguments: {} }))
ok(list.some((d) => d.id === made.id && d.title === 'from the wire' && d.role === 'owner'), 'the desk lists it')
const read = toolText(await mcp(aKey, 'tools/call', { name: 'read_draft', arguments: { id: made.id } }))
ok(read.html.includes('first line') && read.html.includes('second thought'), 'the page reads back')

// the blob must open as a real yjs room — load it the way collab.js does
const meta = await jget(`/api/docs/${made.id}`, alice)
ok(meta.title === 'from the wire', 'the app sees the machine-made page')
const vres = await raw('GET', `/api/docs/${made.id}/versions`, undefined, alice)
ok(vres.ok, 'the page stands where versions can reach it')

// ---- the margins ----
await post(`/api/docs/${made.id}/comments`, { text: 'lovely opener', quote: 'first line' }, alice)
const margins = toolText(await mcp(aKey, 'tools/call', { name: 'read_comments', arguments: { id: made.id } }))
ok(margins.length === 1 && margins[0].text === 'lovely opener' && margins[0].settled === false, 'the margins read back')

// ---- one desk per key ----
const bList = toolText(await mcp(bKey, 'tools/call', { name: 'list_drafts', arguments: {} }))
ok(!bList.some((d) => d.id === made.id), 'another key sees another desk')
const bRead = await mcp(bKey, 'tools/call', { name: 'read_draft', arguments: { id: made.id } })
ok(bRead.isError === true, 'a guessed draft id reads as nothing')

// ---- keys cap and revoke ----
for (let i = 0; i < 4; i++) await jpost('/api/tokens', { label: `k${i}` }, alice)
ok((await raw('POST', '/api/tokens', {}, alice)).status === 400, 'five keys at most')
const first = (await jget('/api/tokens', alice)).tokens[0]
await req('DELETE', `/api/tokens/${first.id}`, undefined, alice)
ok((await mcp(aKey, 'initialize', INIT, true)) === 401, 'a revoked key opens nothing')

process.exit(failed)

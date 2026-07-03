// A second pen for manual co-writing tests: signs in, joins the doc, and
// keeps appending to the FIRST paragraph so a human (or a screenshot) in the
// browser can watch the "written twice" note appear.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const [username, password, docId, seconds = '30'] = process.argv.slice(2)
const BASE = process.env.AUTHOR_BASE || 'http://localhost:4999'
const WS = process.env.AUTHOR_WS_URL || BASE.replace(/^http/, 'ws') + '/ws'

const res = await fetch(`${BASE}/api/auth/sign-in/username`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username, password }),
})
if (!res.ok) throw new Error(`sign-in: ${res.status} ${await res.text()}`)
const cookie = (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')

class AuthedWS extends WebSocket {
  constructor(u, protocols) {
    super(u, protocols, { headers: { Cookie: cookie } })
  }
}
const doc = new Y.Doc()
const provider = new WebsocketProvider(WS, docId, doc, { WebSocketPolyfill: AuthedWS })
provider.awareness.setLocalStateField('user', { name: username, color: '#8a2be2' })
await new Promise((r) => provider.once('sync', r))
console.log('joined', docId)

const frag = doc.getXmlFragment('default')
const until = Date.now() + Number(seconds) * 1000
const tick = setInterval(() => {
  if (Date.now() > until) {
    clearInterval(tick)
    provider.destroy()
    process.exit(0)
  }
  doc.transact(() => {
    let p = frag.get(0)
    if (!p) {
      p = new Y.XmlElement('paragraph')
      frag.insert(0, [p])
    }
    const text = p.get(0)
    if (text) text.insert(text.length, ' …and mine')
    else p.insert(0, [new Y.XmlText('the second pen writes')])
  })
  console.log('wrote at', new Date().toLocaleTimeString())
}, 3000)

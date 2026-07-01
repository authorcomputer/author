// Two Yjs clients editing the same doc through the author* server.
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const [tokenA, tokenB, docId] = process.argv.slice(2)
const url = 'ws://localhost:3001/ws'

function makeClient(name, token) {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(url, docId, doc, {
    WebSocketPolyfill: WebSocket,
    params: { token },
  })
  provider.awareness.setLocalStateField('user', { name, color: '#000' })
  return { name, doc, provider }
}

const a = makeClient('ink', tokenA)
const b = makeClient('quill', tokenB)

const synced = (c) =>
  new Promise((res) => (c.provider.synced ? res() : c.provider.once('sync', res)))

await Promise.all([synced(a), synced(b)])
console.log('both clients synced')

// ink types into the shared fragment (tiptap uses the "default" XmlFragment)
const fragA = a.doc.getXmlFragment('default')
a.doc.transact(() => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('hello from ink, over the wire')])
  fragA.insert(0, [p])
})
a.doc.getMap('meta').set('title', 'wire test')

await new Promise((r) => setTimeout(r, 800))

const fragB = b.doc.getXmlFragment('default')
const textSeenByB = fragB.toString()
const titleSeenByB = b.doc.getMap('meta').get('title')
console.log('quill sees content:', textSeenByB)
console.log('quill sees title:', titleSeenByB)

// quill replies
b.doc.transact(() => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('quill writes back')])
  b.doc.getXmlFragment('default').insert(1, [p])
})
await new Promise((r) => setTimeout(r, 800))
console.log('ink sees content:', a.doc.getXmlFragment('default').toString())

// presence
const namesSeenByA = Array.from(a.provider.awareness.getStates().values())
  .map((s) => s.user?.name)
  .filter(Boolean)
console.log('presence seen by ink:', namesSeenByA.sort().join(', '))

const pass =
  textSeenByB.includes('hello from ink') &&
  titleSeenByB === 'wire test' &&
  a.doc.getXmlFragment('default').toString().includes('quill writes back') &&
  namesSeenByA.includes('quill')

console.log(pass ? 'PASS: live collaboration works both ways' : 'FAIL')
a.provider.destroy()
b.provider.destroy()
process.exit(pass ? 0 : 1)

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
const cookie = process.argv[2]
class AuthedWS extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { headers: { Cookie: cookie } }) }
}
const doc = new Y.Doc()
const p = new WebsocketProvider('ws://localhost:3001/ws', process.argv[3], doc, { WebSocketPolyfill: AuthedWS })
const t = setTimeout(() => { console.log('FAIL: no sync'); process.exit(1) }, 8000)
p.once('sync', () => { clearTimeout(t); console.log('PASS: ws sync with cookie auth'); p.destroy(); process.exit(0) })

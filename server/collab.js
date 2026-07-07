// Minimal Yjs websocket sync server (y-websocket wire protocol) with SQLite persistence.
import crypto from 'node:crypto'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync.js'
import * as awarenessProtocol from 'y-protocols/awareness.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { db, loadYDoc, saveYDoc } from './db.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const rooms = new Map() // docId -> room

function getRoom(docId) {
  let room = rooms.get(docId)
  if (room) return room

  const ydoc = new Y.Doc()
  const stored = loadYDoc(docId)
  if (stored) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(stored))
    } catch (e) {
      console.error('failed to load ydoc', docId, e)
    }
  }
  const awareness = new awarenessProtocol.Awareness(ydoc)
  awareness.setLocalState(null)

  room = {
    id: docId,
    ydoc,
    awareness,
    conns: new Map(),
    names: new Map(), // ws -> username, for the co-editing snapshot below
    lastAutoSnap: 0,
    saveTimer: null,
    idleTimer: null,
    lastEdit: 0,
    lastSnap: 0, // the mid-flow clock; reset at the start of each sitting
    editors: [], // who was at the desk when the last change landed
    destroyTimer: null,
  }

  awareness.on('update', ({ added, updated, removed }) => {
    const changed = added.concat(updated, removed)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
    )
    broadcast(room, encoding.toUint8Array(enc))
  })

  ydoc.on('update', (update) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeUpdate(enc, update)
    broadcast(room, encoding.toUint8Array(enc))
    scheduleSave(room)
    noteEdit(room)
  })

  rooms.set(docId, room)
  return room
}

function broadcast(room, buf) {
  for (const ws of room.conns.keys()) {
    send(ws, buf)
  }
}

function send(ws, buf) {
  if (ws.readyState !== 1) return
  try {
    ws.send(buf, (err) => err && ws.close())
  } catch {
    ws.close()
  }
}

function persist(room) {
  try {
    const title = room.ydoc.getMap('meta').get('title')
    saveYDoc(room.id, Buffer.from(Y.encodeStateAsUpdate(room.ydoc)), title)
  } catch (e) {
    console.error('persist failed', room.id, e)
  }
}

function scheduleSave(room) {
  if (room.saveTimer) return
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null
    persist(room)
  }, 1500)
}

// words count, and so do images and embeds — an all-media page is
// still a page worth keeping
const hasStuff = (n) =>
  (n.text || '').trim() ||
  n.type === 'image' ||
  n.type === 'embed' ||
  (n.content || []).some(hasStuff)

// five minutes without a change means the writer stopped somewhere
// deliberate — that settled state is worth keeping. the timer resets on
// every edit, so versions land at the pauses, not mid-sentence; a room
// that unloads with the timer still pending flushes early, since leaving
// is the most settled a page gets.
const IDLE_SNAP_GAP = Number(process.env.AUTHOR_IDLE_SNAP_MS) || 5 * 60 * 1000
// a long unbroken session should not go unkept just because the pen never
// rested — notion cuts every 10 minutes of activity, and so do we
const ACTIVE_SNAP_GAP = Number(process.env.AUTHOR_ACTIVE_SNAP_MS) || 10 * 60 * 1000

// every change lands here: it re-arms the idle timer, and while a sitting
// stays unbroken it also keeps the mid-flow clock honest
function noteEdit(room) {
  const now = Date.now()
  // an edit within the idle gap of the previous one continues the sitting;
  // anything later begins a new one
  const flowing = now - room.lastEdit < IDLE_SNAP_GAP
  room.lastEdit = now
  // remember who was here for the change itself — by the time the timer
  // fires (or the room unloads and flushes), the writer may be gone
  room.editors = [...room.names.values()]
  if (room.idleTimer) clearTimeout(room.idleTimer)
  room.idleTimer = setTimeout(() => {
    room.idleTimer = null
    snapshotOnSettle(room)
  }, IDLE_SNAP_GAP)
  if (!flowing) {
    // the first stroke after a break starts the flow clock — it is not,
    // by itself, ten minutes of flow
    room.lastSnap = Math.max(room.lastSnap, now)
  } else if (now - room.lastSnap >= ACTIVE_SNAP_GAP) {
    // stamped before the walk so a dedupe skip can't re-trigger per keystroke;
    // deferred so the doc walk never blocks the message path
    room.lastSnap = now
    setImmediate(() => snapshotOnSettle(room, 'flow'))
  }
}

const ownerUsername = (docId) =>
  db
    .prepare('SELECT u.username FROM user u JOIN docs d ON d.owner_id = u.id WHERE d.id = ?')
    .get(docId)?.username || 'author*'

// auto versions carry no name — the panel shows them by their moment.
// kind is the machine-readable marker: 'idle' | 'flow' | 'join' | 'manual'
function insertVersion(docId, username, json, ts, kind) {
  db.prepare(
    "INSERT INTO versions (id, doc_id, name, username, content, created_at, kind) VALUES (?, ?, '', ?, ?, ?, ?)"
  ).run('v_' + crypto.randomBytes(8).toString('hex'), docId, username, json, ts, kind)
}

function snapshotOnSettle(room, kind = 'idle') {
  try {
    const content = yDocToProsemirrorJSON(room.ydoc, 'default')
    if (!hasStuff(content)) return
    const json = JSON.stringify(content)
    const latest = db
      .prepare(
        'SELECT content, created_at FROM versions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(room.id)
    if (latest) {
      // any version written since we last looked moves the flow clock —
      // a manual save counts as keeping the stretch
      room.lastSnap = Math.max(room.lastSnap, latest.created_at)
      // a mid-flow version only marks stretches nothing else kept
      if (kind === 'flow' && Date.now() - latest.created_at < ACTIVE_SNAP_GAP) return
      // a version kept after the last change (a manual save, mostly) already
      // holds this settled state — client and server serialize the same doc
      // slightly differently, so trust the clock, not just the bytes
      if (latest.created_at >= room.lastEdit) return
      if (latest.content === json) return
    }
    // credit whoever was at the desk for the change if it was one person
    // (one account — pen names can repeat); otherwise the page's owner
    const ids = new Set(room.editors.map((u) => u.id))
    const username =
      ids.size === 1 ? room.editors[0].username : ownerUsername(room.id)
    room.lastSnap = Date.now()
    insertVersion(room.id, username, json, room.lastSnap, kind)
  } catch (e) {
    console.error('auto snapshot failed', room.id, e)
  }
}

// versions are the safety net for co-editing: the moment a second writer
// joins, quietly keep "as X joined" so the text of that moment is one click
// away if a merge ever goes semantically wrong. throttled against the
// versions table itself (rooms unload after 30s idle and on deploys, so an
// in-memory clock alone would forget) — any version in the last stretch,
// manual or automatic, is restore point enough.
const AUTO_SNAP_GAP = 10 * 60 * 1000

function snapshotOnCompany(room) {
  // off the ws-upgrade path: the doc-to-JSON walk and the insert can wait
  // until after the joiner's handshake
  setImmediate(() => {
    const now = Date.now()
    if (now - room.lastAutoSnap < AUTO_SNAP_GAP) return
    try {
      // throttle against our own snapshots only — a manual save minutes ago
      // doesn't capture the state at THIS join, which is the whole point
      const latest = db
        .prepare(
          "SELECT MAX(created_at) AS t FROM versions WHERE doc_id = ? AND kind = 'join'"
        )
        .get(room.id)
      if (latest?.t && now - latest.t < AUTO_SNAP_GAP) return
      const content = yDocToProsemirrorJSON(room.ydoc, 'default')
      if (!hasStuff(content)) return
      room.lastAutoSnap = now
      room.lastSnap = Math.max(room.lastSnap, now)
      // credit the page's owner — "whose text this was" — not whoever's
      // socket happened to open first
      insertVersion(room.id, ownerUsername(room.id), JSON.stringify(content), now, 'join')
    } catch (e) {
      console.error('auto snapshot failed', room.id, e)
    }
  })
}

function closeConn(room, ws) {
  const clientIds = room.conns.get(ws)
  if (clientIds) {
    room.conns.delete(ws)
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(clientIds), null)
  }
  room.names.delete(ws)
  try {
    ws.close()
  } catch {}
  if (room.conns.size === 0) {
    persist(room)
    // keep the doc warm briefly, then unload. clear any timer a double
    // close ('error' then 'close') already armed — a stale one surviving
    // past a reconnect could tear down a room that came back to life
    if (room.destroyTimer) clearTimeout(room.destroyTimer)
    room.destroyTimer = setTimeout(() => {
      if (room.conns.size === 0) {
        flushRoom(room)
        room.ydoc.destroy()
        rooms.delete(room.id)
      }
    }, 30_000)
  }
}

// a room's last duty, on unload and on shutdown alike: write the doc down,
// and give a pending idle version its moment
function flushRoom(room) {
  persist(room)
  if (room.idleTimer) {
    clearTimeout(room.idleTimer)
    room.idleTimer = null
    snapshotOnSettle(room)
  }
}

// deploys don't wait five minutes
export function flushRooms() {
  for (const room of rooms.values()) flushRoom(room)
}

export function setupCollab(ws, docId, user) {
  const room = getRoom(docId)
  if (room.destroyTimer) {
    clearTimeout(room.destroyTimer)
    room.destroyTimer = null
  }
  // a second distinct writer arriving is the co-editing boundary. distinct
  // means a different account (ghosts included — every anonymous session
  // has its own id); the same person in two tabs doesn't count
  if (user?.id) {
    const ids = new Set([...room.names.values()].map((u) => u.id))
    if (ids.size === 1 && !ids.has(user.id)) {
      snapshotOnCompany(room)
    }
    room.names.set(ws, { id: user.id, username: user.username })
  }
  room.conns.set(ws, new Set())
  ws.binaryType = 'arraybuffer'

  ws.on('message', (data) => {
    try {
      const message = new Uint8Array(data)
      const decoder = decoding.createDecoder(message)
      const messageType = decoding.readVarUint(decoder)
      switch (messageType) {
        case MESSAGE_SYNC: {
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, enc, room.ydoc, ws)
          if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
          break
        }
        case MESSAGE_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder)
          // track which awareness clientIds belong to this connection
          const dec2 = decoding.createDecoder(update)
          const len = decoding.readVarUint(dec2)
          const ids = room.conns.get(ws)
          for (let i = 0; i < len; i++) {
            const clientId = decoding.readVarUint(dec2)
            decoding.readVarUint(dec2) // clock
            decoding.readVarString(dec2) // state
            if (ids) ids.add(clientId)
          }
          awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws)
          break
        }
        default:
          break
      }
    } catch (e) {
      console.error('collab message error', e)
    }
  })

  ws.on('close', () => closeConn(room, ws))
  ws.on('error', () => closeConn(room, ws))

  // handshake: sync step 1 + current awareness
  {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, room.ydoc)
    send(ws, encoding.toUint8Array(enc))
  }
  const states = room.awareness.getStates()
  if (states.size > 0) {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys()))
    )
    send(ws, encoding.toUint8Array(enc))
  }
}

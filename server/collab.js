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

// versions are the safety net for co-editing: the moment a second writer
// joins, quietly keep "as X joined" so the text of that moment is one click
// away if a merge ever goes semantically wrong. throttled against the
// versions table itself (rooms unload after 30s idle and on deploys, so an
// in-memory clock alone would forget) — any version in the last stretch,
// manual or automatic, is restore point enough.
const AUTO_SNAP_GAP = 10 * 60 * 1000

function snapshotOnCompany(room, joiner) {
  // off the ws-upgrade path: the doc-to-JSON walk and the insert can wait
  // until after the joiner's handshake
  setImmediate(() => {
    const now = Date.now()
    if (now - room.lastAutoSnap < AUTO_SNAP_GAP) return
    try {
      const latest = db
        .prepare('SELECT MAX(created_at) AS t FROM versions WHERE doc_id = ?')
        .get(room.id)
      if (latest?.t && now - latest.t < AUTO_SNAP_GAP) return
      const content = yDocToProsemirrorJSON(room.ydoc, 'default')
      // words count, and so do images and embeds — an all-media page is
      // still a page worth keeping
      const hasStuff = (n) =>
        (n.text || '').trim() ||
        n.type === 'image' ||
        n.type === 'embed' ||
        (n.content || []).some(hasStuff)
      if (!hasStuff(content)) return
      // credit the page's owner — "whose text this was" — not whoever's
      // socket happened to open first
      const owner = db
        .prepare(
          'SELECT u.username FROM user u JOIN docs d ON d.owner_id = u.id WHERE d.id = ?'
        )
        .get(room.id)
      room.lastAutoSnap = now
      db.prepare(
        'INSERT INTO versions (id, doc_id, name, username, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        'v_' + crypto.randomBytes(8).toString('hex'),
        room.id,
        `as ${joiner} joined`,
        owner?.username || 'author*',
        JSON.stringify(content),
        now
      )
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
    // keep the doc warm briefly, then unload
    room.destroyTimer = setTimeout(() => {
      if (room.conns.size === 0) {
        persist(room)
        room.ydoc.destroy()
        rooms.delete(room.id)
      }
    }, 30_000)
  }
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
      snapshotOnCompany(room, user.username)
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

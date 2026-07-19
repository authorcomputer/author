// Minimal Yjs websocket sync server (y-websocket wire protocol) with SQLite persistence.
import crypto from 'node:crypto'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync.js'
import * as awarenessProtocol from 'y-protocols/awareness.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { db, loadYDoc, saveYDoc, addEvent, addEditEvents } from './db.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const rooms = new Map() // docId -> room

function getRoom(docId) {
  let room = rooms.get(docId)
  if (room) return room

  const ydoc = new Y.Doc()
  const stored = loadYDoc(docId)
  // bytes that won't parse might still be recoverable — a torn write, a bad
  // restore. the room carries on with an empty stand-in so readers aren't
  // locked out, but it must never write that stand-in back over the original
  let brokenLoad = false
  if (stored) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(stored))
    } catch (e) {
      brokenLoad = true
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
    sittingStart: 0, // when this unbroken stretch of writing began
    editors: [], // who was at the desk when the last change landed
    destroyTimer: null,
    brokenLoad,
    // a visit is not a change: only a real update earns a write (and the
    // updated_at bump that puts the page atop the desk). the stored state is
    // applied above, before the update hook exists, so loading never dirties
    dirty: false,
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
    room.dirty = true
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

// a clientId belongs to the account that first spoke it. the wire carries no
// signature, so the session behind the socket is the only proof we get: a
// frame naming a cursor another *account* holds is forgery.
function forgedBy(room, ws, clientId) {
  const mine = room.names.get(ws)
  for (const [conn, ids] of room.conns) {
    if (conn === ws || !ids.has(clientId)) continue
    const theirs = room.names.get(conn)
    if (!mine || !theirs || theirs.id !== mine.id) return true
  }
  return false
}

// the same writer on a second socket is no forger but a reconnect —
// y-websocket keeps its clientID across a drop, and a half-open socket can
// linger long past it. hand the id to the live connection, so when the stale
// one is finally reaped its close cannot erase a cursor that never left.
function takeClientId(room, ws, clientId) {
  for (const [conn, ids] of room.conns) {
    if (conn !== ws) ids.delete(clientId)
  }
  room.conns.get(ws)?.add(clientId)
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
  // nothing changed since the last write — leave the stored bytes and their
  // timestamp alone, or every glance at a page would shuffle the desk
  if (!room.dirty) return
  // the empty stand-in for a blob that wouldn't load is not the document —
  // saving it would turn maybe-recoverable corruption into a certain blank.
  // but real content — a restored version, or words deliberately typed — is
  // the document now: it heals the room and earns the write. only a still-blank
  // broken room refuses.
  if (room.brokenLoad) {
    let content
    try {
      content = yDocToProsemirrorJSON(room.ydoc, 'default')
    } catch {
      return
    }
    if (!hasStuff(content)) return
    room.brokenLoad = false
  }
  try {
    const title = room.ydoc.getMap('meta').get('title')
    saveYDoc(room.id, Buffer.from(Y.encodeStateAsUpdate(room.ydoc)), title)
    room.dirty = false
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
  if (!flowing) room.sittingStart = now
  room.lastEdit = now
  // remember who was here for the change itself — by the time the timer
  // fires (or the room unloads and flushes), the writer may be gone. a
  // commenter at the desk is reading, not writing: crediting them a version
  // or a line of edit history would put words in a pen that can't write
  room.editors = [...room.names.values()].filter((u) => !u.readOnly)
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

const ownerByline = (docId) =>
  db
    .prepare('SELECT u.id, u.username FROM user u JOIN docs d ON d.owner_id = u.id WHERE d.id = ?')
    .get(docId) || { id: null, username: 'author*' }

// kind is the machine-readable marker: 'idle' | 'flow' | 'join' | 'manual'.
// the client titles every non-manual version by its moment, so auto names
// are pure metadata — idle/flow store none, join remembers who arrived.
// the byline carries both name and id: the name is the display snapshot,
// the id is what a later handle rename may key on — names repeat, ids don't
// how many words a stored snapshot holds — the measure an edit entry wears
export function wordsOf(node) {
  if (!node) return 0
  let text = ''
  const walk = (n) => {
    if (n.text) text += n.text + ' '
    for (const c of n.content || []) walk(c)
  }
  walk(node)
  return (text.match(/\S+/g) || []).length
}

export function insertVersion(docId, name, byline, json, ts, kind, editors, editInfo) {
  const id = 'v_' + crypto.randomBytes(8).toString('hex')
  db.prepare(
    'INSERT INTO versions (id, doc_id, name, username, user_id, content, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, docId, name, byline.username, byline.id || null, json, ts, kind)
  // versions are where writing becomes history: a deliberate save is its own
  // entry, and the automatic ones (idle, flow) mark that someone wrote —
  // join snapshots record presence, not work, so they stay out of the log.
  // the version credits one byline; the edit entries name every pen that was
  // at the desk, or the desk would show writers their own words as news.
  // a save's entry wears the version's own ts, so the diff it opens can
  // never mistake the kept version for the page before it.
  // known wart: the entry lands when the sitting settles, minutes after the
  // words — a reader who opened mid-gap may see the sitting flagged once
  // more. over-shown, never lost; opening the page clears it.
  if (kind === 'manual') addEvent(docId, byline, 'version.save', name, ts)
  else if (kind === 'idle' || kind === 'flow')
    addEditEvents(docId, editors?.length ? editors : [byline], editInfo || {})
  return id
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
    const byline = ids.size === 1 ? room.editors[0] : ownerByline(room.id)
    room.lastSnap = Date.now()
    // this stretch's net word change, measured against the last version
    // that counted as work — join snapshots record presence, so measuring
    // against one would erase the words it happened to capture. the stretch
    // anchors just past its baseline: the count and the diff a history row
    // opens must always cover the same span.
    const base = db
      .prepare(
        "SELECT content, created_at FROM versions WHERE doc_id = ? AND kind != 'join' ORDER BY created_at DESC LIMIT 1"
      )
      .get(room.id)
    let prevWords = 0
    if (base) {
      try {
        prevWords = wordsOf(JSON.parse(base.content))
      } catch {}
    }
    insertVersion(room.id, '', byline, json, room.lastSnap, kind, room.editors, {
      delta: wordsOf(content) - prevWords,
      sittingStart: room.sittingStart || room.lastEdit,
      stretchStart: base ? base.created_at + 1 : room.sittingStart || room.lastEdit,
    })
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

function snapshotOnCompany(room, joiner) {
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
      insertVersion(room.id, `as ${joiner} joined`, ownerByline(room.id), JSON.stringify(content), now, 'join')
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

// a loaded room is presence enough — someone has the page open, even if
// they haven't typed yet
export const hasRoom = (docId) => rooms.has(docId)

// deletion's other half: when the row goes, the live room goes with it —
// otherwise editors keep typing into saves that match nothing, and the
// settle timers keep minting versions for a page that isn't there
export function dropRoom(docId) {
  const room = rooms.get(docId)
  if (!room) return
  rooms.delete(docId)
  for (const t of ['saveTimer', 'idleTimer', 'destroyTimer']) {
    if (room[t]) clearTimeout(room[t])
    room[t] = null
  }
  for (const ws of room.conns.keys()) {
    try {
      ws.close()
    } catch {}
  }
  room.conns.clear()
  room.awareness.destroy()
  room.ydoc.destroy()
}

export function setupCollab(ws, docId, user, readOnly = false) {
  const room = getRoom(docId)
  if (room.destroyTimer) {
    clearTimeout(room.destroyTimer)
    room.destroyTimer = null
  }
  // a second distinct writer arriving is the co-editing boundary. distinct
  // means a different account (ghosts included — every anonymous session
  // has its own id); the same person in two tabs doesn't count. a commenter
  // arriving isn't one — their pen can't cause the merge the snapshot guards
  if (user?.id) {
    if (!readOnly) {
      const ids = new Set([...room.names.values()].filter((u) => !u.readOnly).map((u) => u.id))
      if (ids.size === 1 && !ids.has(user.id)) {
        snapshotOnCompany(room, user.username)
      }
    }
    room.names.set(ws, { id: user.id, username: user.username, readOnly })
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
          // a read-only socket is answered but never believed: its step 1
          // gets our state, its step 2s and updates fall to the floor — the
          // wire carries no signature, so the role decides, not the frame
          if (readOnly) {
            const t = decoding.readVarUint(decoder)
            if (t === syncProtocol.messageYjsSyncStep1) {
              const enc = encoding.createEncoder()
              encoding.writeVarUint(enc, MESSAGE_SYNC)
              syncProtocol.readSyncStep1(decoder, enc, room.ydoc)
              send(ws, encoding.toUint8Array(enc))
            }
            break
          }
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, enc, room.ydoc, ws)
          if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
          break
        }
        case MESSAGE_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder)
          // learn which awareness clientIds this connection speaks for
          const dec2 = decoding.createDecoder(update)
          const len = decoding.readVarUint(dec2)
          const incoming = []
          for (let i = 0; i < len; i++) {
            const clientId = decoding.readVarUint(dec2)
            decoding.readVarUint(dec2) // clock
            decoding.readVarString(dec2) // state
            incoming.push(clientId)
          }
          // a frame naming a cursor another account holds is presence-forgery:
          // drop it whole, or it would override that writer now and, on this
          // socket's close, erase them from everyone's view. checked before a
          // single id changes hands, so a forged tail can't strand a claimed head
          if (incoming.some((id) => forgedBy(room, ws, id))) break
          for (const id of incoming) takeClientId(room, ws, id)
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

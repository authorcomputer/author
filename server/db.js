import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

const dataDir = path.join(process.cwd(), 'data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'author.db'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT DEFAULT 'untitled',
  ydoc BLOB,
  html TEXT DEFAULT '',
  published INTEGER DEFAULT 0,
  slug TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collaborators (
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (doc_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  quote TEXT DEFAULT '',
  text TEXT NOT NULL,
  resolved INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_versions_doc_created ON versions(doc_id, created_at);
CREATE TABLE IF NOT EXISTS activity (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  label TEXT,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 25
);
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  profile_public INTEGER DEFAULT 0,
  show_writing INTEGER DEFAULT 1,
  links TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS doc_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  started_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_doc_events_doc ON doc_events(doc_id, id);
CREATE INDEX IF NOT EXISTS idx_doc_events_user ON doc_events(user_id);
CREATE TABLE IF NOT EXISTS read_cursors (
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_id, user_id)
);
`)

// lightweight migrations for pre-existing databases. returns whether the
// column was created just now, so one-time backfills can key on it
function addColumn(table, ddl) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    return true
  } catch {
    return false /* column already exists */
  }
}
addColumn('users', 'profile_public INTEGER DEFAULT 0')
addColumn('users', 'show_writing INTEGER DEFAULT 1')
addColumn('users', "links TEXT DEFAULT '[]'")
addColumn('users', 'email TEXT')
addColumn('docs', 'header_image TEXT')
addColumn('docs', 'on_profile INTEGER DEFAULT 1')
addColumn('invite_codes', 'max_uses INTEGER DEFAULT 25')
addColumn('profiles', 'member INTEGER DEFAULT 0')
// versions carry a kind so the client can tell deliberate saves from auto
// ones without leaning on display names. classified once, the moment the
// column first appears, from the poetic names old rows were born with —
// the names themselves are kept: they're history, and 'as X joined' is the
// only record of who joined
if (addColumn('versions', "kind TEXT DEFAULT 'manual'")) {
  db.exec(`UPDATE versions SET kind = 'join' WHERE name LIKE 'as % joined'`)
  db.exec(`UPDATE versions SET kind = 'idle' WHERE name = 'as the ink dried'`)
  db.exec(`UPDATE versions SET kind = 'flow' WHERE name = 'while the ink flowed'`)
}

// an edit entry remembers when its run of writing began, not just when it
// settled — the diff a history row opens must reach back to the page as it
// stood before the sitting, however many collapses the run went through
addColumn('doc_events', 'started_at INTEGER')

// a collaborator wears a role: an editor writes, a commenter only speaks in
// the margins. everyone enrolled before roles existed was let in to write.
addColumn('collaborators', "role TEXT DEFAULT 'editor'")
// the review door: a token that opens the page for commenting, not writing —
// it must not contain or reveal the doc id, or the narrower key would carry
// the wider one inside it
addColumn('docs', 'review_token TEXT')
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_review ON docs(review_token) WHERE review_token IS NOT NULL'
)

// versions remember whose pen signed them, so a handle rename can follow
// the writer instead of the name — a pen name can echo a handle, so the
// name alone proves nothing. no backfill: guessing owners for old rows by
// that same string match is the misattribution the column exists to end
addColumn('versions', 'user_id TEXT')

// a comment can carry a proposed replacement for its quoted passage
addColumn('comments', "suggestion TEXT DEFAULT ''")
// how a thread ended, and who ended it: a suggested edit is accepted or
// rejected, a note is resolved — the review loop's memory. rows settled
// before the column existed keep an empty outcome; unknown stays unknown.
addColumn('comments', "outcome TEXT DEFAULT ''")
addColumn('comments', "resolved_by TEXT DEFAULT ''")
addColumn('comments', 'resolved_at INTEGER')
// replies thread under a parent comment
addColumn('comments', "parent_id TEXT DEFAULT ''")
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL')

// seed two invite codes: one personal, one to hand to friends
// (codes are stored lowercase; signup lowercases input to match)
const codeCount = db.prepare('SELECT COUNT(*) AS c FROM invite_codes').get()
if (codeCount.c === 0) {
  const mk = () => 'author-' + crypto.randomBytes(4).toString('hex')
  const ins = db.prepare('INSERT INTO invite_codes (code, label, max_uses) VALUES (?, ?, ?)')
  const personal = mk()
  const friends = mk()
  ins.run(personal, 'personal', 2)
  ins.run(friends, 'friends', 25)
  console.log(`invite codes — personal: ${personal} · friends: ${friends}`)
}
db.exec(`UPDATE invite_codes SET max_uses = CASE label WHEN 'personal' THEN 2 ELSE 25 END WHERE max_uses IS NULL`)

// Seed the two test accounts (uniform password: "author"; hashed like all passwords)
const count = db.prepare('SELECT COUNT(*) AS c FROM users').get()
if (count.c === 0) {
  const ins = db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)')
  ins.run('u_ink', 'ink', bcrypt.hashSync('author', 10))
  ins.run('u_quill', 'quill', bcrypt.hashSync('author', 10))
  console.log('seeded test accounts: ink / quill (password: "author")')
}

// migrate any plaintext passwords to bcrypt; in production, the seeded test
// accounts' publicly-known password is rotated to a random one (existing
// sessions stay valid — set a fresh password in settings afterwards)
const isProd = !!process.env.FLY_APP_NAME || process.env.NODE_ENV === 'production'
for (const u of db.prepare("SELECT id, username, password FROM users WHERE password NOT LIKE '$2%'").all()) {
  const compromised = isProd && ['ink', 'quill'].includes(u.username) && u.password === 'author'
  const next = compromised ? crypto.randomBytes(18).toString('hex') : u.password
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), u.id)
  if (compromised) console.log(`rotated known password for seeded account "${u.username}"`)
}

export function loadYDoc(docId) {
  const row = db.prepare('SELECT ydoc FROM docs WHERE id = ?').get(docId)
  return row && row.ydoc ? row.ydoc : null
}

export function saveYDoc(docId, buf, title) {
  if (title !== undefined && title !== null) {
    db.prepare('UPDATE docs SET ydoc = ?, title = ?, updated_at = ? WHERE id = ?').run(
      buf,
      String(title).slice(0, 300) || 'untitled',
      Date.now(),
      docId
    )
  } else {
    db.prepare('UPDATE docs SET ydoc = ?, updated_at = ? WHERE id = ?').run(buf, Date.now(), docId)
  }
}

export function docExists(docId) {
  return !!db.prepare('SELECT id FROM docs WHERE id = ?').get(docId)
}

// the doc's history: one appended row per thing that happened, in the order
// it happened. ids are the reading order — a reader's cursor points at the
// last one they've seen, and everything past it is news. the byline carries
// id and name like versions do: the name is the display snapshot, the id is
// what renames and cursors key on.
export function addEvent(docId, byline, type, detail = '', startedAt = null) {
  const now = Date.now()
  db.prepare(
    'INSERT INTO doc_events (doc_id, user_id, username, type, detail, created_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    docId,
    byline.id || '',
    byline.username,
    type,
    String(detail).slice(0, 200),
    now,
    startedAt || now
  )
}

// a long afternoon of writing is one line of history per pen, not fifty —
// while nothing else lands in between, the sitting's edit entries collapse
// to the freshest run. anything else arriving pins the run in place. this is
// the log's one exception to append-only, held inside a transaction so a
// crash can't land between the delete and its replacement. every pen at the
// desk gets its own entry: a version credits one byline, but news must name
// whoever actually wrote, or the desk shows writers their own words as news.
// an edit entry's detail is its net word count — additive across a run's
// collapses (words are the one measure that sums), and each pen keeps its
// own arithmetic: a stretch several pens shared counts for no one, but the
// counts a pen earned alone survive every collapse. the run is the SITTING:
// only entries minted since this sitting began collapse, so yesterday's
// writing keeps its own line and its own moment. started_at points at the
// version each row's words were measured against — the far edge of the
// diff the row opens — and never reaches past a pin into another row's span.
const EDIT_DELTA_RE = /^([+-]\d+) words$/
const fmtDelta = (n) => (n > 0 ? `+${n} words` : n < 0 ? `${n} words` : '')
export const addEditEvents = db.transaction(
  (docId, bylines, { delta = 0, sittingStart = 0, stretchStart = 0 } = {}) => {
    const writers = new Map()
    for (const b of bylines) writers.set(b.id || '', b)
    // per-pen ledger from the rows this collapse absorbs. the walk covers
    // the sitting's trailing edit rows: rows by pens writing NOW are
    // absorbed; another pen's line from earlier in the sitting stands where
    // it is — skipped, never a wall (or a pen returning to solo work after
    // company could never rejoin its own earlier count)
    const carried = new Map() // user_id -> { net, started }
    for (const last of db
      .prepare(
        'SELECT id, user_id, type, detail, created_at, started_at FROM doc_events WHERE doc_id = ? ORDER BY id DESC LIMIT 50'
      )
      .all(docId)) {
      if (last.type !== 'edit') break
      if (sittingStart && last.created_at < sittingStart) break
      if (!writers.has(last.user_id)) continue
      const prev = carried.get(last.user_id) || { net: 0, started: Infinity }
      carried.set(last.user_id, {
        net: prev.net + Number(EDIT_DELTA_RE.exec(last.detail)?.[1] || 0),
        started: Math.min(prev.started, last.started_at || last.created_at),
      })
      db.prepare('DELETE FROM doc_events WHERE id = ?').run(last.id)
    }
    const solo = writers.size === 1
    for (const [uid, b] of writers) {
      const c = carried.get(uid) || { net: 0, started: Infinity }
      const net = c.net + (solo ? delta : 0)
      addEvent(docId, b, 'edit', fmtDelta(net), Math.min(c.started, stretchStart || Infinity) || sittingStart)
    }
  }
)

// point a reader's cursor at the end of the log — everything so far is seen.
// one statement, and the update refuses when nothing moved, so a caught-up
// tab's steady nudges cost a read, not a write
export function markSeen(docId, userId) {
  db.prepare(
    `INSERT INTO read_cursors (doc_id, user_id, last_event_id)
     VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM doc_events WHERE doc_id = ?))
     ON CONFLICT(doc_id, user_id) DO UPDATE SET last_event_id = excluded.last_event_id
     WHERE last_event_id != excluded.last_event_id`
  ).run(docId, userId, docId)
}

// everything a page owns, gone in one breath — the delete route and the
// ghost sweep both speak through here, so a new doc-scoped table is added
// once, not remembered twice. callers hold the transaction.
export function purgeDocRows(docId) {
  db.prepare('DELETE FROM docs WHERE id = ?').run(docId)
  db.prepare('DELETE FROM comments WHERE doc_id = ?').run(docId)
  db.prepare('DELETE FROM versions WHERE doc_id = ?').run(docId)
  db.prepare('DELETE FROM collaborators WHERE doc_id = ?').run(docId)
  db.prepare('DELETE FROM doc_events WHERE doc_id = ?').run(docId)
  db.prepare('DELETE FROM read_cursors WHERE doc_id = ?').run(docId)
}

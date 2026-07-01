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
  created_at INTEGER NOT NULL
);
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
`)

// lightweight migrations for pre-existing databases
function addColumn(table, ddl) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  } catch {
    /* column already exists */
  }
}
addColumn('users', 'profile_public INTEGER DEFAULT 0')
addColumn('users', 'show_writing INTEGER DEFAULT 1')
addColumn('users', "links TEXT DEFAULT '[]'")
addColumn('users', 'email TEXT')
addColumn('docs', 'header_image TEXT')
addColumn('invite_codes', 'max_uses INTEGER DEFAULT 25')
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

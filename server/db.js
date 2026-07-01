import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

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
`)

// Seed the two test accounts (uniform password: "author")
const count = db.prepare('SELECT COUNT(*) AS c FROM users').get()
if (count.c === 0) {
  const ins = db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)')
  ins.run('u_ink', 'ink', 'author')
  ins.run('u_quill', 'quill', 'author')
  console.log('seeded test accounts: ink / quill (password: "author")')
}

export function userByToken(token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token)
  return row || null
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

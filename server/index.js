import 'dotenv/config'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import { db, userByToken, docExists } from './db.js'
import { setupCollab } from './collab.js'
import { aiFeedback, aiCommand, aiTitles, aiChecks } from './ai.js'

const app = express()
app.use(express.json({ limit: '5mb' }))

const uid = (p) => p + '_' + crypto.randomBytes(8).toString('hex')

// ---------- auth ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const user = userByToken(token)
  if (!user) return res.status(401).json({ error: 'not signed in' })
  req.user = user
  next()
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND password = ?')
    .get(String(username || '').toLowerCase().trim(), String(password || ''))
  if (!user) return res.status(401).json({ error: 'wrong name or password' })
  const token = crypto.randomBytes(24).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    Date.now()
  )
  res.json({ token, username: user.username })
})

app.get('/api/me', auth, (req, res) => res.json(req.user))

// ---------- docs ----------
app.get('/api/docs', auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.id, d.title, d.updated_at, d.published, d.slug, d.owner_id, d.html,
              (d.owner_id = ?) AS mine
       FROM docs d
       WHERE d.owner_id = ? OR d.id IN (SELECT doc_id FROM collaborators WHERE user_id = ?)
       ORDER BY d.updated_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id)
  res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      updated_at: r.updated_at,
      published: !!r.published,
      slug: r.slug,
      mine: !!r.mine,
      snippet: String(r.html || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140),
    }))
  )
})

app.post('/api/docs', auth, (req, res) => {
  const id = uid('doc')
  const now = Date.now()
  db.prepare(
    'INSERT INTO docs (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.user.id, (req.body && req.body.title) || 'untitled', now, now)
  res.json({ id })
})

app.get('/api/docs/:id', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) {
    db.prepare('INSERT OR IGNORE INTO collaborators (doc_id, user_id) VALUES (?, ?)').run(
      doc.id,
      req.user.id
    )
  }
  const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(doc.owner_id)
  res.json({
    id: doc.id,
    title: doc.title,
    published: !!doc.published,
    slug: doc.slug,
    mine: doc.owner_id === req.user.id,
    owner: owner ? owner.username : '?',
  })
})

app.delete('/api/docs/:id', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'not yours' })
  db.prepare('DELETE FROM docs WHERE id = ?').run(doc.id)
  db.prepare('DELETE FROM comments WHERE doc_id = ?').run(doc.id)
  db.prepare('DELETE FROM versions WHERE doc_id = ?').run(doc.id)
  db.prepare('DELETE FROM collaborators WHERE doc_id = ?').run(doc.id)
  res.json({ ok: true })
})

// html snapshot (for list snippets + published page)
app.post('/api/docs/:id/html', auth, (req, res) => {
  if (!docExists(req.params.id)) return res.status(404).json({ error: 'no such doc' })
  db.prepare('UPDATE docs SET html = ? WHERE id = ?').run(
    String((req.body && req.body.html) || ''),
    req.params.id
  )
  res.json({ ok: true })
})

app.post('/api/docs/:id/publish', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  const publish = !!(req.body && req.body.publish)
  let slug = doc.slug
  if (publish && !slug) slug = crypto.randomBytes(5).toString('hex')
  if (req.body && typeof req.body.html === 'string') {
    db.prepare('UPDATE docs SET html = ? WHERE id = ?').run(req.body.html, doc.id)
  }
  db.prepare('UPDATE docs SET published = ?, slug = ? WHERE id = ?').run(
    publish ? 1 : 0,
    slug,
    doc.id
  )
  res.json({ published: publish, slug })
})

app.get('/api/public/:slug', (req, res) => {
  const doc = db
    .prepare('SELECT title, html, updated_at FROM docs WHERE slug = ? AND published = 1')
    .get(req.params.slug)
  if (!doc) return res.status(404).json({ error: 'nothing here' })
  res.json(doc)
})

// ---------- comments ----------
app.get('/api/docs/:id/comments', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at ASC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ ...r, resolved: !!r.resolved })))
})

app.post('/api/docs/:id/comments', auth, (req, res) => {
  const { text, quote, id } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty comment' })
  const cid = id || uid('c')
  db.prepare(
    'INSERT INTO comments (id, doc_id, user_id, username, quote, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(cid, req.params.id, req.user.id, req.user.username, String(quote || '').slice(0, 500), text.trim(), Date.now())
  res.json({ id: cid })
})

app.post('/api/comments/:cid/resolve', auth, (req, res) => {
  db.prepare('UPDATE comments SET resolved = 1 WHERE id = ?').run(req.params.cid)
  res.json({ ok: true })
})

// ---------- versions ----------
app.get('/api/docs/:id/versions', auth, (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name, username, created_at FROM versions WHERE doc_id = ? ORDER BY created_at DESC'
    )
    .all(req.params.id)
  res.json(rows)
})

app.post('/api/docs/:id/versions', auth, (req, res) => {
  const { name, content } = req.body || {}
  if (!content) return res.status(400).json({ error: 'no content' })
  const vid = uid('v')
  db.prepare(
    'INSERT INTO versions (id, doc_id, name, username, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    vid,
    req.params.id,
    String(name || '').trim() || 'unnamed version',
    req.user.username,
    JSON.stringify(content),
    Date.now()
  )
  res.json({ id: vid })
})

app.get('/api/versions/:vid', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM versions WHERE id = ?').get(req.params.vid)
  if (!row) return res.status(404).json({ error: 'no such version' })
  res.json({ id: row.id, name: row.name, content: JSON.parse(row.content) })
})

// ---------- ai ----------
app.post('/api/ai/feedback', auth, aiFeedback)
app.post('/api/ai/command', auth, aiCommand)
app.post('/api/ai/titles', auth, aiTitles)
app.post('/api/ai/checks', auth, aiChecks)

// ---------- static client ----------
const dist = path.join(process.cwd(), 'dist')
app.use(express.static(dist))
app.get(/^\/(?!api\/|ws\/).*/, (req, res) => {
  res.sendFile(path.join(dist, 'index.html'))
})

// ---------- websocket ----------
const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  const match = url.pathname.match(/^\/ws\/([^/]+)$/)
  if (!match) return socket.destroy()
  const docId = match[1]
  const token = url.searchParams.get('token')
  const user = userByToken(token)
  if (!user || !docExists(docId)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return socket.destroy()
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    setupCollab(ws, docId)
  })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`author* listening on http://localhost:${PORT}`)
})

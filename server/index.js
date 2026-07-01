import 'dotenv/config'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import bcrypt from 'bcryptjs'
import sanitizeHtml from 'sanitize-html'
import { db, userByToken, docExists } from './db.js'
import { setupCollab } from './collab.js'
import { aiFeedback, aiCommand, aiTitles, aiChecks } from './ai.js'

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  next()
})

const uid = (p) => p + '_' + crypto.randomBytes(8).toString('hex')

// Doc snapshots are rendered on the public read-only page with
// dangerouslySetInnerHTML — allow only what the editor actually produces.
function cleanHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
      'blockquote', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'hr', 'span', 'a',
    ],
    allowedAttributes: { span: ['data-comment-id'], a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  })
}

// ---------- auth ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const user = userByToken(token)
  if (!user) return res.status(401).json({ error: 'not signed in' })
  req.user = user
  next()
}

// small in-memory per-IP throttle for the credential endpoints
const buckets = new Map()
function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const ip = req.headers['fly-client-ip'] || req.ip || '?'
    const key = `${req.path}|${ip}`
    const now = Date.now()
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs)
    if (hits.length >= limit) return res.status(429).json({ error: 'slow down a moment' })
    hits.push(now)
    buckets.set(key, hits)
    if (buckets.size > 10000) buckets.clear() // crude memory bound
    next()
  }
}

function startSession(res, user) {
  const token = crypto.randomBytes(24).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    Date.now()
  )
  res.json({ token, username: user.username })
}

app.post('/api/login', rateLimit(12, 60_000), (req, res) => {
  const { username, password } = req.body || {}
  const ident = String(username || '').toLowerCase().trim()
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(ident, ident)
  if (!user || !bcrypt.compareSync(String(password || ''), user.password)) {
    // flat delay takes the speed out of online guessing
    return setTimeout(() => res.status(401).json({ error: 'wrong name or password' }), 400)
  }
  startSession(res, user)
})

app.post('/api/signup', rateLimit(8, 60_000), (req, res) => {
  const { username, email, password, code } = req.body || {}
  const uname = String(username || '').toLowerCase().trim()
  const mail = String(email || '').toLowerCase().trim()
  if (!/^[a-z0-9_-]{2,24}$/.test(uname))
    return res.status(400).json({ error: 'handle: 2–24 letters, numbers, - or _' })
  if (!/^\S+@\S+\.\S+$/.test(mail))
    return res.status(400).json({ error: 'that email looks off' })
  if (String(password || '').length < 6)
    return res.status(400).json({ error: 'password: six characters at least' })
  const invite = db
    .prepare('SELECT * FROM invite_codes WHERE code = ?')
    .get(String(code || '').trim().toLowerCase())
  if (!invite) return res.status(403).json({ error: 'that invite code doesn’t open the door' })
  if (invite.uses >= (invite.max_uses ?? 25))
    return res.status(403).json({ error: 'that invite code is all used up' })
  if (db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(uname, mail))
    return res.status(409).json({ error: 'that name or email already has a desk' })
  const id = uid('u')
  db.prepare('INSERT INTO users (id, username, password, email) VALUES (?, ?, ?, ?)').run(
    id,
    uname,
    bcrypt.hashSync(String(password), 10),
    mail
  )
  db.prepare('UPDATE invite_codes SET uses = uses + 1 WHERE code = ?').run(invite.code)
  startSession(res, { id, username: uname })
})

app.get('/api/me', auth, (req, res) => res.json(req.user))

app.post('/api/password', auth, (req, res) => {
  const p = String((req.body || {}).password || '')
  if (p.length < 6) return res.status(400).json({ error: 'six characters at least' })
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(p, 10), req.user.id)
  // sign out everywhere else
  const current = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, current)
  res.json({ ok: true })
})

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
    header_image: doc.header_image || null,
  })
})

app.delete('/api/docs/:id', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'not yours' })
  removeHeaderFile(doc.header_image)
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
    cleanHtml(req.body && req.body.html),
    req.params.id
  )
  // writing activity, for the profile contribution chart (UTC days)
  const day = new Date().toISOString().slice(0, 10)
  db.prepare(
    `INSERT INTO activity (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`
  ).run(req.user.id, day)
  res.json({ ok: true })
})

app.post('/api/docs/:id/publish', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  const publish = !!(req.body && req.body.publish)
  let slug = doc.slug
  if (publish && !slug) slug = crypto.randomBytes(5).toString('hex')
  if (req.body && typeof req.body.html === 'string') {
    db.prepare('UPDATE docs SET html = ? WHERE id = ?').run(cleanHtml(req.body.html), doc.id)
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
    .prepare(
      'SELECT title, html, header_image, updated_at FROM docs WHERE slug = ? AND published = 1'
    )
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

// ---------- header images ----------
const uploadsDir = path.join(process.cwd(), 'data', 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

const IMG_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// content-type alone is attacker-controlled — check the file signature too
function magicOk(ext, b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return false
  if (ext === 'jpg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (ext === 'png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  if (ext === 'gif') return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46
  if (ext === 'webp')
    return b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP'
  return false
}

function uploadsDirSize() {
  let total = 0
  for (const f of fs.readdirSync(uploadsDir)) {
    try {
      total += fs.statSync(path.join(uploadsDir, f)).size
    } catch {}
  }
  return total
}

function removeHeaderFile(url) {
  if (!url || !url.startsWith('/files/')) return
  fs.unlink(path.join(uploadsDir, path.basename(url)), () => {})
}

// migrate any pre-existing header files that embedded the doc id in their
// public URL (the doc id is an edit capability — it must never be public)
for (const row of db
  .prepare("SELECT id, header_image FROM docs WHERE header_image LIKE '/files/doc_%'")
  .all()) {
  const old = path.basename(row.header_image)
  const fresh = crypto.randomBytes(12).toString('hex') + '.' + old.split('.').pop()
  try {
    db.prepare('UPDATE docs SET header_image = ? WHERE id = ?').run('/files/' + fresh, row.id)
    try {
      fs.renameSync(path.join(uploadsDir, old), path.join(uploadsDir, fresh))
    } catch {
      // file missing or rename failed — point the row back at the old name
      db.prepare('UPDATE docs SET header_image = ? WHERE id = ?').run(row.header_image, row.id)
    }
  } catch {}
}

app.post(
  '/api/docs/:id/header',
  auth,
  express.raw({ type: Object.keys(IMG_EXT), limit: '8mb' }),
  (req, res) => {
    const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
    if (!doc) return res.status(404).json({ error: 'no such doc' })
    const ext = IMG_EXT[(req.headers['content-type'] || '').split(';')[0]]
    if (!ext || !magicOk(ext, req.body)) {
      return res.status(400).json({ error: 'send a jpeg, png, webp, or gif' })
    }
    if (uploadsDirSize() > 500 * 1024 * 1024) {
      return res.status(507).json({ error: 'image storage is full' })
    }
    const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`
    fs.writeFileSync(path.join(uploadsDir, name), req.body)
    removeHeaderFile(doc.header_image)
    const url = `/files/${name}`
    db.prepare('UPDATE docs SET header_image = ? WHERE id = ?').run(url, doc.id)
    res.json({ url })
  }
)

app.delete('/api/docs/:id/header', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  removeHeaderFile(doc.header_image)
  db.prepare('UPDATE docs SET header_image = NULL WHERE id = ?').run(doc.id)
  res.json({ ok: true })
})

app.use('/files', express.static(uploadsDir, { maxAge: '30d', immutable: true }))

// ---------- profile & settings ----------
function safeLinks(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l) => typeof l === 'string')
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\/\S+$/i.test(l) && l.length <= 200)
    .slice(0, 6)
}

app.get('/api/settings', auth, (req, res) => {
  const row = db
    .prepare('SELECT profile_public, show_writing, links FROM users WHERE id = ?')
    .get(req.user.id)
  res.json({
    username: req.user.username,
    profile_public: !!row.profile_public,
    show_writing: !!row.show_writing,
    links: JSON.parse(row.links || '[]'),
  })
})

app.post('/api/settings', auth, (req, res) => {
  const { profile_public, show_writing, links } = req.body || {}
  db.prepare('UPDATE users SET profile_public = ?, show_writing = ?, links = ? WHERE id = ?').run(
    profile_public ? 1 : 0,
    show_writing ? 1 : 0,
    JSON.stringify(safeLinks(links)),
    req.user.id
  )
  res.json({ ok: true })
})

app.get('/api/profile/:username', (req, res) => {
  const u = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(req.params.username || '').toLowerCase())
  if (!u || !u.profile_public) return res.status(404).json({ error: 'no such profile' })
  const activity = db
    .prepare(
      `SELECT day, count FROM activity WHERE user_id = ? AND day >= date('now', '-181 day')`
    )
    .all(u.id)
  const articles = u.show_writing
    ? db
        .prepare(
          `SELECT title, slug, updated_at FROM docs
           WHERE owner_id = ? AND published = 1 ORDER BY updated_at DESC`
        )
        .all(u.id)
    : []
  res.json({
    username: u.username,
    links: JSON.parse(u.links || '[]'),
    show_writing: !!u.show_writing,
    activity,
    articles,
  })
})

// ---------- ai ----------
// per-user daily cap so the model bill can't be run up by one account
const AI_DAILY_CAP = Number(process.env.AI_DAILY_CAP || 150)
const AI_GLOBAL_DAILY_CAP = Number(process.env.AI_GLOBAL_DAILY_CAP || 1000)
function aiLimit(req, res, next) {
  const day = new Date().toISOString().slice(0, 10)
  const row = db
    .prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?')
    .get(req.user.id, day)
  if (row && row.count >= AI_DAILY_CAP) {
    return res.status(429).json({ error: 'the pen rests — daily limit reached, back tomorrow' })
  }
  const global = db.prepare('SELECT COALESCE(SUM(count), 0) AS s FROM ai_usage WHERE day = ?').get(day)
  if (global.s >= AI_GLOBAL_DAILY_CAP) {
    return res.status(429).json({ error: 'the pen rests — the whole desk hit its daily limit' })
  }
  db.prepare(
    `INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`
  ).run(req.user.id, day)
  next()
}

app.post('/api/ai/feedback', auth, aiLimit, aiFeedback)
app.post('/api/ai/command', auth, aiLimit, aiCommand)
app.post('/api/ai/titles', auth, aiLimit, aiTitles)
app.post('/api/ai/checks', auth, aiLimit, aiChecks)

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

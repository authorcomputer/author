import 'dotenv/config'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import bcrypt from 'bcryptjs'
import sanitizeHtml from 'sanitize-html'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { db, docExists } from './db.js'
import { auth, runAuthMigrations, migrateLegacyUsers, TRUSTED_ORIGINS } from './auth.js'
import { setupCollab } from './collab.js'
import { aiFeedback, aiCommand, aiTitles, aiChecks } from './ai.js'

const app = express()

// security headers — CSP is belt-and-suspenders over the server-side
// sanitization; websocket origins are listed explicitly for older Safari
const WSS_ORIGINS = TRUSTED_ORIGINS.map((o) => o.replace(/^http/, 'ws')).join(' ')
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.seline.com",
  "style-src 'self' 'unsafe-inline'", // react inline style attributes
  "img-src 'self' data: blob:",
  `connect-src 'self' https://api.seline.com ${WSS_ORIGINS}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// better-auth needs the raw request body — mount before express.json
app.all('/api/auth/*', toNodeHandler(auth))
app.use(express.json({ limit: '5mb' }))

// CSRF defense-in-depth: sessions are cookies now, so refuse mutating
// cross-origin requests outright instead of leaning on SameSite alone
// (better-auth origin-checks its own /api/auth routes)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.headers.origin
  if (origin && !TRUSTED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'cross-origin request refused' })
  }
  next()
})

const uid = (p) => p + '_' + crypto.randomBytes(8).toString('hex')

// html snapshot → readable text, for snippets and word counts. inline marks
// vanish (Tiptap splits words with them: '<strong>re</strong>ally'), block
// tags and entities become spaces so paragraphs don't fuse into one word.
function textOf(html) {
  return String(html || '')
    .replace(/<\/?(?:strong|b|em|i|u|s|code|a|span)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
}

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

// ---------- auth (better-auth cookie sessions; ghosts are anonymous users) ----------
async function getUser(headers) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) })
  if (!session?.user) return null
  const u = session.user
  return {
    id: u.id,
    username: u.username || u.displayUsername || 'ghost',
    anon: !!u.isAnonymous,
  }
}

function requireUser(req, res, next) {
  getUser(req.headers)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'not signed in' })
      req.user = user
      next()
    })
    .catch(next)
}

// for things that mean "keeping" — ghosts get nudged to take a desk
function requireFullUser(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.anon)
      return res
        .status(403)
        .json({ error: 'take a desk to keep things', code: 'account_required' })
    next()
  })
}

// small in-memory per-IP throttle for signup
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

// open signup: email + password. a handle is generated and renameable in
// settings. account creation is delegated to better-auth (which also links
// a ghost session's work into the new account via the anonymous plugin)
app.post('/api/signup', rateLimit(8, 60_000), async (req, res) => {
  const { email, password } = req.body || {}
  const mail = String(email || '').toLowerCase().trim()
  if (!/^\S+@\S+\.\S+$/.test(mail))
    return res.status(400).json({ error: 'that email looks off' })
  if (String(password || '').length < 6)
    return res.status(400).json({ error: 'password: six characters at least' })
  if (db.prepare('SELECT id FROM user WHERE email = ?').get(mail))
    return res.status(409).json({ error: 'that email already has a desk' })
  let uname
  do {
    uname = 'writer-' + crypto.randomBytes(2).toString('hex')
  } while (db.prepare('SELECT id FROM user WHERE username = ?').get(uname))
  try {
    const response = await auth.api.signUpEmail({
      body: { name: uname, username: uname, email: mail, password: String(password) },
      headers: fromNodeHeaders(req.headers), // carries a ghost session for linking
      asResponse: true,
    })
    const cookies = response.headers.getSetCookie?.() || []
    if (cookies.length) res.setHeader('Set-Cookie', cookies)
    const body = await response.text()
    res.status(response.status).type('application/json').send(body || '{}')
  } catch (e) {
    console.error('signup error', e)
    res.status(400).json({ error: e?.body?.message || e?.message || 'signup failed' })
  }
})

app.get('/api/me', requireUser, (req, res) => res.json(req.user))

app.post('/api/handle', requireFullUser, (req, res) => {
  const uname = String((req.body || {}).username || '').toLowerCase().trim()
  if (!/^[a-z0-9_-]{2,24}$/.test(uname))
    return res.status(400).json({ error: 'handle: 2–24 letters, numbers, - or _' })
  if (uname === req.user.username) return res.json({ username: uname })
  if (db.prepare('SELECT id FROM user WHERE username = ?').get(uname))
    return res.status(409).json({ error: 'that handle already has a desk' })
  const old = req.user.username
  db.prepare('UPDATE user SET username = ?, displayUsername = ?, name = ? WHERE id = ?').run(
    uname,
    uname,
    uname,
    req.user.id
  )
  // display-name snapshots on past comments and versions follow the rename
  db.prepare('UPDATE comments SET username = ? WHERE user_id = ?').run(uname, req.user.id)
  db.prepare('UPDATE versions SET username = ? WHERE username = ?').run(uname, old)
  res.json({ username: uname })
})

app.post('/api/password', requireFullUser, async (req, res) => {
  const p = String((req.body || {}).password || '')
  if (p.length < 6) return res.status(400).json({ error: 'six characters at least' })
  db.prepare(
    `UPDATE account SET password = ? WHERE userId = ? AND providerId = 'credential'`
  ).run(bcrypt.hashSync(p, 10), req.user.id)
  // sign out everywhere else
  await auth.api
    .revokeOtherSessions({ headers: fromNodeHeaders(req.headers) })
    .catch(() => {})
  res.json({ ok: true })
})

// ---------- docs ----------
app.get('/api/docs', requireUser, (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.id, d.title, d.updated_at, d.published, d.slug, d.owner_id, d.html,
              d.header_image, (d.owner_id = ?) AS mine
       FROM docs d
       WHERE d.owner_id = ? OR d.id IN (SELECT doc_id FROM collaborators WHERE user_id = ?)
       ORDER BY d.updated_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id)
  res.json(
    rows.map((r) => {
      const text = textOf(r.html).replace(/\s+/g, ' ').trim()
      return {
        id: r.id,
        title: r.title,
        updated_at: r.updated_at,
        published: !!r.published,
        slug: r.slug,
        mine: !!r.mine,
        header_image: r.header_image || null,
        on_profile: !!r.on_profile,
        snippet: text.slice(0, 140),
        preview: text.slice(0, 420),
      }
    })
  )
})

// own writing activity, for the desk chart
app.get('/api/activity', requireUser, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT day, count FROM activity WHERE user_id = ? AND day >= date('now', '-181 day')`
      )
      .all(req.user.id)
  )
})

app.post('/api/docs', requireUser, (req, res) => {
  const id = uid('doc')
  const now = Date.now()
  db.prepare(
    'INSERT INTO docs (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.user.id, (req.body && req.body.title) || 'untitled', now, now)
  res.json({ id })
})

function docMeta(doc, userId) {
  const owner = db.prepare('SELECT username FROM user WHERE id = ?').get(doc.owner_id)
  return {
    id: doc.id,
    title: doc.title,
    published: !!doc.published,
    slug: doc.slug,
    mine: doc.owner_id === userId,
    owner: owner?.username || 'a ghost',
    header_image: doc.header_image || null,
    on_profile: !!doc.on_profile,
  }
}

// side-effect-free read (a GET must never enroll anyone — lax cookies ride
// on top-level navigations, so a mutating GET is a CSRF hole)
app.get('/api/docs/:id', requireUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  res.json(docMeta(doc, req.user.id))
})

// opening a doc in the editor — this is what enrolls a collaborator
app.post('/api/docs/:id/open', requireUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) {
    db.prepare('INSERT OR IGNORE INTO collaborators (doc_id, user_id) VALUES (?, ?)').run(
      doc.id,
      req.user.id
    )
  }
  res.json(docMeta(doc, req.user.id))
})

app.delete('/api/docs/:id', requireUser, (req, res) => {
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
app.post('/api/docs/:id/html', requireUser, (req, res) => {
  if (!docExists(req.params.id)) return res.status(404).json({ error: 'no such doc' })
  db.prepare('UPDATE docs SET html = ? WHERE id = ?').run(
    cleanHtml(req.body && req.body.html),
    req.params.id
  )
  // writing activity, for the profile contribution chart. the client sends
  // its own local day so the chart follows the writer's clock, not UTC's;
  // it must sit within a day of UTC-now (any real timezone does)
  const utcDay = new Date().toISOString().slice(0, 10)
  const claimed = req.body && req.body.day
  const day =
    typeof claimed === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(claimed) &&
    Math.abs(Date.parse(claimed) - Date.parse(utcDay)) <= 86400000
      ? claimed
      : utcDay
  db.prepare(
    `INSERT INTO activity (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`
  ).run(req.user.id, day)
  res.json({ ok: true })
})

// whether a published page is listed on the owner's public profile
app.post('/api/docs/:id/profile', requireFullUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'not yours' })
  const show = !!(req.body && req.body.show)
  db.prepare('UPDATE docs SET on_profile = ? WHERE id = ?').run(show ? 1 : 0, doc.id)
  res.json({ on_profile: show })
})

// publishing is "keeping" — full accounts only
app.post('/api/docs/:id/publish', requireFullUser, (req, res) => {
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
  // author rides along for the byline; the profile link only makes sense
  // when the profile itself is public
  const doc = db
    .prepare(
      `SELECT d.title, d.html, d.header_image, d.updated_at,
              u.username AS author, COALESCE(p.profile_public, 0) AS author_public
       FROM docs d
       JOIN user u ON u.id = d.owner_id
       LEFT JOIN profiles p ON p.user_id = d.owner_id
       WHERE d.slug = ? AND d.published = 1`
    )
    .get(req.params.slug)
  if (!doc) return res.status(404).json({ error: 'nothing here' })
  res.json({ ...doc, author_public: !!doc.author_public })
})

// ---------- comments ----------
app.get('/api/docs/:id/comments', requireUser, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at ASC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ ...r, resolved: !!r.resolved })))
})

app.post('/api/docs/:id/comments', requireUser, (req, res) => {
  const { text, quote, id } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty comment' })
  const cid = id || uid('c')
  db.prepare(
    'INSERT INTO comments (id, doc_id, user_id, username, quote, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(cid, req.params.id, req.user.id, req.user.username, String(quote || '').slice(0, 500), text.trim(), Date.now())
  res.json({ id: cid })
})

app.post('/api/comments/:cid/resolve', requireUser, (req, res) => {
  db.prepare('UPDATE comments SET resolved = 1 WHERE id = ?').run(req.params.cid)
  res.json({ ok: true })
})

// ---------- versions ----------
app.get('/api/docs/:id/versions', requireUser, (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name, username, created_at FROM versions WHERE doc_id = ? ORDER BY created_at DESC'
    )
    .all(req.params.id)
  res.json(rows)
})

// saving a version is "keeping" — full accounts only
app.post('/api/docs/:id/versions', requireFullUser, (req, res) => {
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

app.get('/api/versions/:vid', requireUser, (req, res) => {
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

app.post(
  '/api/docs/:id/header',
  requireUser,
  express.raw({ type: Object.keys(IMG_EXT), limit: '12mb' }),
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

app.delete('/api/docs/:id/header', requireUser, (req, res) => {
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

function profileFor(userId) {
  return (
    db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) || {
      profile_public: 0,
      show_writing: 1,
      links: '[]',
      member: 0,
    }
  )
}

app.get('/api/settings', requireFullUser, (req, res) => {
  const p = profileFor(req.user.id)
  res.json({
    username: req.user.username,
    profile_public: !!p.profile_public,
    show_writing: !!p.show_writing,
    links: JSON.parse(p.links || '[]'),
  })
})

app.post('/api/settings', requireFullUser, (req, res) => {
  const { profile_public, show_writing, links } = req.body || {}
  db.prepare(
    `INSERT INTO profiles (user_id, profile_public, show_writing, links) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET profile_public = excluded.profile_public,
       show_writing = excluded.show_writing, links = excluded.links`
  ).run(req.user.id, profile_public ? 1 : 0, show_writing ? 1 : 0, JSON.stringify(safeLinks(links)))
  res.json({ ok: true })
})

// ---------- admin (one person's desk lamp, not a control panel) ----------
// no default: this repo is public and its seeded test accounts have a
// documented password, so admin must be granted explicitly per install
// (fly secrets set ADMIN_USER_ID=...)
const ADMIN_USER_ID = process.env.ADMIN_USER_ID

// the word count walks every html snapshot — cache it so an open admin tab
// can't keep the event loop busy re-scanning the whole corpus
let wordCache = { words: 0, at: 0 }
function totalWords() {
  if (Date.now() - wordCache.at < 5 * 60 * 1000) return wordCache.words
  let words = 0
  for (const d of db.prepare('SELECT html FROM docs WHERE html IS NOT NULL').all()) {
    words += (textOf(d.html).match(/\S+/g) || []).length
  }
  wordCache = { words, at: Date.now() }
  return words
}

app.get('/api/admin/stats', requireFullUser, (req, res) => {
  // quiet 404 for everyone else — the page shouldn't admit it exists
  if (!ADMIN_USER_ID || req.user.id !== ADMIN_USER_ID) {
    return res.status(404).json({ error: 'nothing here' })
  }

  const writers = db
    .prepare('SELECT COUNT(*) c FROM user WHERE isAnonymous IS NOT 1').get().c
  const ghosts = db
    .prepare('SELECT COUNT(*) c FROM user WHERE isAnonymous = 1').get().c
  const members = db.prepare('SELECT COUNT(*) c FROM profiles WHERE member = 1').get().c
  const pages = db.prepare('SELECT COUNT(*) c FROM docs').get().c
  const published = db.prepare('SELECT COUNT(*) c FROM docs WHERE published = 1').get().c

  const recent = db
    .prepare(
      `SELECT username, email, createdAt FROM user
       WHERE isAnonymous IS NOT 1 ORDER BY createdAt DESC LIMIT 20`
    )
    .all()

  // emails in the body — keep it out of every cache
  res.set('Cache-Control', 'no-store, private')
  res.json({ writers, ghosts, members, pages, published, words: totalWords(), recent })
})

app.get('/api/profile/:username', (req, res) => {
  const u = db
    .prepare('SELECT id, username FROM user WHERE username = ?')
    .get(String(req.params.username || '').toLowerCase())
  const p = u && profileFor(u.id)
  if (!u || !p.profile_public) return res.status(404).json({ error: 'no such profile' })
  const activity = db
    .prepare(
      `SELECT day, count FROM activity WHERE user_id = ? AND day >= date('now', '-181 day')`
    )
    .all(u.id)
  const articles = p.show_writing
    ? db
        .prepare(
          `SELECT title, slug, updated_at FROM docs
           WHERE owner_id = ? AND published = 1 AND on_profile = 1
           ORDER BY updated_at DESC`
        )
        .all(u.id)
    : []
  res.json({
    username: u.username,
    links: JSON.parse(p.links || '[]'),
    show_writing: !!p.show_writing,
    activity,
    articles,
  })
})

// ---------- ai ----------
// ghosts get one on the house; free accounts get a monthly allowance;
// members ($10/mo, email author@dutilh.net) get a generous daily cap; the
// site as a whole has a hard daily budget
const AI_DAILY_CAP = Number(process.env.AI_DAILY_CAP || 150)
const AI_GHOST_CAP = Number(process.env.AI_GHOST_CAP || 1)
const AI_FREE_MONTHLY = Number(process.env.AI_FREE_MONTHLY || 5)
const AI_GLOBAL_DAILY_CAP = Number(process.env.AI_GLOBAL_DAILY_CAP || 1000)
const AI_GHOST_IP_CAP = Number(process.env.AI_GHOST_IP_CAP || 3)
function bumpUsage(key, day) {
  db.prepare(
    `INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`
  ).run(key, day)
}
function aiLimit(req, res, next) {
  // don't charge anyone for a request that can't run
  const b = req.body || {}
  const hasInput = [b.text, b.selection, b.context, b.instruction].some(
    (v) => typeof v === 'string' && v.trim()
  )
  if (!hasInput) return res.status(400).json({ error: 'nothing to read yet — write a little first' })

  const day = new Date().toISOString().slice(0, 10)

  if (req.user.anon) {
    const accountRequired = () =>
      res.status(403).json({
        error: 'that one was on the house — take a desk for more',
        code: 'account_required',
      })
    const row = db
      .prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?')
      .get(req.user.id, day)
    if (row && row.count >= AI_GHOST_CAP) return accountRequired()
    // fresh ghosts are free to mint — cap the IP, not just the ghost
    const ipKey = 'ip:' + (req.headers['fly-client-ip'] || req.ip || '?')
    const ipRow = db
      .prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?')
      .get(ipKey, day)
    if (ipRow && ipRow.count >= AI_GHOST_IP_CAP) return accountRequired()
    bumpUsage(ipKey, day)
  } else if (profileFor(req.user.id).member) {
    const row = db
      .prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?')
      .get(req.user.id, day)
    if (row && row.count >= AI_DAILY_CAP) {
      return res.status(429).json({ error: 'the pen rests — daily limit reached, back tomorrow' })
    }
  } else {
    const month = db
      .prepare(
        `SELECT COALESCE(SUM(count), 0) AS s FROM ai_usage
         WHERE user_id = ? AND day >= date('now', 'start of month')`
      )
      .get(req.user.id)
    if (month.s >= AI_FREE_MONTHLY) {
      return res.status(403).json({
        error: `that's the ${AI_FREE_MONTHLY} free requests this month — membership is $10/mo`,
        code: 'membership_required',
      })
    }
  }

  const global = db.prepare('SELECT COALESCE(SUM(count), 0) AS s FROM ai_usage WHERE day = ?').get(day)
  if (global.s >= AI_GLOBAL_DAILY_CAP) {
    return res.status(429).json({ error: 'the pen rests — the whole desk hit its daily limit' })
  }
  bumpUsage(req.user.id, day)
  next()
}

app.post('/api/ai/feedback', requireUser, aiLimit, aiFeedback)
app.post('/api/ai/command', requireUser, aiLimit, aiCommand)
app.post('/api/ai/titles', requireUser, aiLimit, aiTitles)
app.post('/api/ai/checks', requireUser, aiLimit, aiChecks)

// ---------- static client ----------
const dist = path.join(process.cwd(), 'dist')
// hashed assets cache forever; index.html must always revalidate so open
// tabs pick up new bundles on refresh
app.use(express.static(dist, { index: false, maxAge: '365d', immutable: true }))
app.get(/^\/(?!api\/|ws\/).*/, (req, res) => {
  res.set('Cache-Control', 'no-cache')
  res.sendFile(path.join(dist, 'index.html'))
})

// ---------- websocket ----------
const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  const match = url.pathname.match(/^\/ws\/([^/]+)$/)
  if (!match) return socket.destroy()
  // browsers always send Origin on ws handshakes — refuse cross-site sockets
  const origin = req.headers.origin
  if (origin && !TRUSTED_ORIGINS.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    return socket.destroy()
  }
  const docId = match[1]
  // sessions are cookie-based; the browser sends them on the ws handshake
  getUser(req.headers)
    .then((user) => {
      if (!user || !docExists(docId)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        return socket.destroy()
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        setupCollab(ws, docId)
      })
    })
    .catch(() => socket.destroy())
})

// sweep ghosts that drifted off: anonymous users whose sessions have all
// expired and who haven't written in two weeks, along with their pages
function sweepGhosts() {
  const nowIso = new Date().toISOString()
  const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000
  const stale = db
    .prepare(
      `SELECT u.id FROM user u
       WHERE u.isAnonymous = 1
         AND u.id NOT IN (SELECT userId FROM session WHERE expiresAt > ?)
         AND COALESCE((SELECT MAX(updated_at) FROM docs WHERE owner_id = u.id), 0) < ?`
    )
    .all(nowIso, cutoffMs)
  for (const { id } of stale) {
    for (const d of db.prepare('SELECT id, header_image FROM docs WHERE owner_id = ?').all(id)) {
      removeHeaderFile(d.header_image)
      db.prepare('DELETE FROM comments WHERE doc_id = ?').run(d.id)
      db.prepare('DELETE FROM versions WHERE doc_id = ?').run(d.id)
      db.prepare('DELETE FROM collaborators WHERE doc_id = ?').run(d.id)
    }
    db.prepare('DELETE FROM docs WHERE owner_id = ?').run(id)
    db.prepare('DELETE FROM collaborators WHERE user_id = ?').run(id)
    db.prepare('DELETE FROM activity WHERE user_id = ?').run(id)
    db.prepare('DELETE FROM ai_usage WHERE user_id = ?').run(id)
    db.prepare('DELETE FROM account WHERE userId = ?').run(id)
    db.prepare('DELETE FROM session WHERE userId = ?').run(id)
    db.prepare('DELETE FROM user WHERE id = ?').run(id)
  }
  if (stale.length) console.log(`swept ${stale.length} drifted ghost(s)`)
}

const PORT = process.env.PORT || 3001
await runAuthMigrations()
await migrateLegacyUsers()
sweepGhosts()
setInterval(sweepGhosts, 24 * 60 * 60 * 1000).unref()
server.listen(PORT, () => {
  console.log(`author* listening on http://localhost:${PORT}`)
})

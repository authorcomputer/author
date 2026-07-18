import 'dotenv/config'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import bcrypt from 'bcryptjs'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { cleanHtml } from './clean-html.js'
import { db, docExists, addEvent, markSeen, purgeDocRows } from './db.js'
import { auth, runAuthMigrations, migrateLegacyUsers, TRUSTED_ORIGINS } from './auth.js'
import { setupCollab, flushRooms, insertVersion, dropRoom, hasRoom } from './collab.js'
import { putImage, deleteImage, pushMissing, imagesReplicated } from './images.js'
import { aiFeedback, aiCommand, aiChecks } from './ai.js'

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
  // embedded players — must match EMBED_SRC_RE / the client's parseEmbed()
  'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://open.spotify.com https://platform.twitter.com',
].join('; ')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// better-auth's own sign-up desk answers 422 "user already exists" for a
// taken address and 200 for a free one — a plainer enumeration oracle than
// the 409 /api/signup was hardened out of. nothing on the client walks this
// route; the product signs up through /api/signup (rate-limited, flat-no,
// ghost-linking), which reaches better-auth in-process, not over this path.
// so shut the public door with a 404 that admits nothing. ghost sign-in,
// email sign-in, and session routes under /api/auth/* still pass through.
app.all('/api/auth/sign-up/email', (req, res) => res.status(404).json({ error: 'nothing here' }))

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
// readable text collapsed to a single line and trimmed to n chars — snippets,
// profile previews, and share-card descriptions all want the same shape
function previewOf(html, n = 420) {
  return textOf(html).replace(/\s+/g, ' ').trim().slice(0, n)
}

// ---------- auth (better-auth cookie sessions; ghosts are anonymous users) ----------
async function getUser(headers) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) })
  if (!session?.user) return null
  const u = session.user
  // a ghost who signed their name at the door (shared-link reviewers) is
  // known by it; the plugin's default "Anonymous" stays the plain 'ghost'
  const penName = u.isAnonymous && u.name && u.name !== 'Anonymous' ? u.name : null
  return {
    id: u.id,
    username: penName || u.username || u.displayUsername || 'ghost',
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

// every signup stumble gets this same flat no — a distinct "taken" reply
// would hand anyone with an email list an oracle for who writes here
const declineSignup = (res) =>
  res.status(400).json({ error: "that didn't take — if this is your address, try signing in" })

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
  if (db.prepare('SELECT id FROM user WHERE email = ?').get(mail)) return declineSignup(res)
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
    const body = await response.text()
    if (!response.ok) {
      // better-auth's own "already exists" must not leak through either —
      // the log keeps the real reason, the wire keeps the flat no
      console.error('signup declined', response.status, body)
      return declineSignup(res)
    }
    const cookies = response.headers.getSetCookie?.() || []
    if (cookies.length) res.setHeader('Set-Cookie', cookies)
    res.status(response.status).type('application/json').send(body || '{}')
  } catch (e) {
    console.error('signup error', e)
    declineSignup(res)
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
  db.prepare('UPDATE user SET username = ?, displayUsername = ?, name = ? WHERE id = ?').run(
    uname,
    uname,
    uname,
    req.user.id
  )
  // display-name snapshots on past comments and versions follow the rename —
  // keyed by id, never by the old name: a ghost's pen name can echo a handle,
  // and an echo must not hand this rename someone else's bylines. rows from
  // before versions carried an id keep the byline they were written with.
  db.prepare('UPDATE comments SET username = ? WHERE user_id = ?').run(uname, req.user.id)
  db.prepare('UPDATE versions SET username = ? WHERE user_id = ?').run(uname, req.user.id)
  db.prepare('UPDATE doc_events SET username = ? WHERE user_id = ?').run(uname, req.user.id)
  res.json({ username: uname })
})

// a ghost arriving through a shared link signs with a pen name — no account,
// no uniqueness; it lives in user.name until they take a desk (the signup
// migration then restamps their comments with the real handle)
app.post('/api/name', requireUser, rateLimit(10, 60_000), (req, res) => {
  if (!req.user.anon)
    return res.status(400).json({ error: 'you already have a handle — rename in settings' })
  const name = String((req.body || {}).name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
  if (!name) return res.status(400).json({ error: 'a name to sign with, any name' })
  const flat = name.toLowerCase()
  // the nameless defaults stay ours, and a pen name may not wear the handle
  // of someone with a desk — same byline, same color, perfect impersonation
  if (flat === 'ghost' || flat === 'anonymous')
    return res.status(400).json({ error: 'that name belongs to the nameless — pick your own' })
  if (
    db
      .prepare('SELECT id FROM user WHERE username = ? OR lower(displayUsername) = ?')
      .get(flat, flat)
  )
    return res.status(409).json({ error: 'that name belongs to a desk here — pick another' })
  db.prepare('UPDATE user SET name = ? WHERE id = ?').run(name, req.user.id)
  // notes they already left follow the name
  db.prepare('UPDATE comments SET username = ? WHERE user_id = ?').run(name, req.user.id)
  db.prepare('UPDATE doc_events SET username = ? WHERE user_id = ?').run(name, req.user.id)
  res.json({ username: name })
})

app.post('/api/password', requireFullUser, async (req, res) => {
  const { current, password } = req.body || {}
  const p = String(password || '')
  if (p.length < 6) return res.status(400).json({ error: 'six characters at least' })
  // a session in hand is not the owner in the chair — only the standing
  // password may choose its successor, so a borrowed browser can't turn
  // one open tab into a locked-out account with no way back
  const cred = db
    .prepare(`SELECT password FROM account WHERE userId = ? AND providerId = 'credential'`)
    .get(req.user.id)
  if (!cred?.password || !bcrypt.compareSync(String(current || ''), cred.password))
    return res.status(403).json({ error: 'your current password first' })
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
              d.header_image, d.on_profile, (d.owner_id = ?) AS mine
       FROM docs d
       WHERE d.owner_id = ? OR d.id IN (SELECT doc_id FROM collaborators WHERE user_id = ?)
       ORDER BY d.updated_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id)
  // what's new per doc since this reader's cursor — their own doings aren't
  // news to them, so only other pens count. one indexed range per listed doc:
  // the doc set is exactly the rows just fetched, and a caught-up doc costs
  // an empty (doc_id, id) scan, not a walk of its whole log
  const cursors = new Map(
    db
      .prepare('SELECT doc_id, last_event_id FROM read_cursors WHERE user_id = ?')
      .all(req.user.id)
      .map((c) => [c.doc_id, c.last_event_id])
  )
  const newsStmt = db.prepare(
    'SELECT type, COUNT(*) AS n FROM doc_events WHERE doc_id = ? AND id > ? AND user_id != ? GROUP BY type'
  )
  res.json(
    rows.map((r) => {
      const news = newsStmt.all(r.id, cursors.get(r.id) || 0, req.user.id)
      const text = previewOf(r.html)
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
        preview: text,
        unseen: news.length ? Object.fromEntries(news.map((e) => [e.type, e.n])) : null,
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
    role: roleFor(doc, userId) || 'editor',
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

// opening a doc in the editor — this is what enrolls a collaborator. the
// write link is the wider key: walking through the writing door grants (or
// restores) the pen, so a commenter later handed /d/<id> isn't locked in
// the margins forever. the doc id was always the write capability — the
// review key merely never carries it, so staying on /r never promotes.
app.post('/api/docs/:id/open', requireUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  let promoted = false
  if (doc.owner_id !== req.user.id) {
    const prev = db
      .prepare('SELECT role FROM collaborators WHERE doc_id = ? AND user_id = ?')
      .get(doc.id, req.user.id)
    db.prepare(
      `INSERT INTO collaborators (doc_id, user_id, role) VALUES (?, ?, 'editor')
       ON CONFLICT(doc_id, user_id) DO UPDATE SET role = 'editor'`
    ).run(doc.id, req.user.id)
    // the socket that upgraded before this promotion still wears the old
    // role — the client reconnects on this flag to pick up its pen
    promoted = prev?.role === 'commenter'
  }
  // opening the page is reading it — the cursor moves to the end of the log
  markSeen(doc.id, req.user.id)
  res.json({ ...docMeta(doc, req.user.id), promoted })
})

// an open tab keeps reading — the client nudges this while the page is up,
// so news that lands mid-visit doesn't greet them as unread tomorrow
app.post('/api/docs/:id/seen', requireUser, (req, res) => {
  if (!docExists(req.params.id)) return res.status(404).json({ error: 'no such doc' })
  markSeen(req.params.id, req.user.id)
  res.json({ ok: true })
})

// the review door's key — minted once per doc, by a pen that can write it.
// the token deliberately carries no doc id: the narrower key must not have
// the wider one folded inside
app.post('/api/docs/:id/review-link', requireUser, (req, res) => {
  const doc = db.prepare('SELECT id, owner_id, review_token FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (!canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
  let token = doc.review_token
  if (!token) {
    token = crypto.randomBytes(10).toString('hex')
    db.prepare('UPDATE docs SET review_token = ? WHERE id = ? AND review_token IS NULL').run(
      token,
      doc.id
    )
    // two tabs can race the mint — whoever lost reads the winner's key
    token = db.prepare('SELECT review_token FROM docs WHERE id = ?').get(doc.id).review_token
  }
  res.json({ token })
})

// through the review door: enrolled to speak, not to write. an owner or an
// already-enrolled editor keeps their standing — a key never demotes. a hit
// enrolls, so the door is throttled: guessing must not be free
app.post('/api/review/:token/open', requireUser, rateLimit(20, 60_000), (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE review_token = ?').get(req.params.token)
  if (!doc) return res.status(404).json({ error: 'nothing here' })
  if (doc.owner_id !== req.user.id) {
    db.prepare(
      "INSERT OR IGNORE INTO collaborators (doc_id, user_id, role) VALUES (?, ?, 'commenter')"
    ).run(doc.id, req.user.id)
  }
  markSeen(doc.id, req.user.id)
  res.json(docMeta(doc, req.user.id))
})

// the history log, newest first — who did what to this page, and when
app.get('/api/docs/:id/events', requireUser, (req, res) => {
  if (!docExists(req.params.id)) return res.status(404).json({ error: 'no such doc' })
  res.json(
    db
      .prepare(
        `SELECT id, username, type, detail, created_at,
                COALESCE(started_at, created_at) AS started_at
         FROM doc_events WHERE doc_id = ? ORDER BY id DESC LIMIT 120`
      )
      .all(req.params.id)
  )
})

app.delete('/api/docs/:id', requireUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'not yours' })
  // the live room goes first — anyone still connected must be cut off, not
  // left typing into saves that match no row
  dropRoom(doc.id)
  db.transaction(() => purgeDocRows(doc.id))()
  unlinkDocImages(doc) // after the rows are gone, so this doc isn't counted as a referrer
  res.json({ ok: true })
})

// html snapshot (for list snippets + published page) — a writing surface,
// so a commenter's pen doesn't reach it
app.post('/api/docs/:id/html', requireUser, (req, res) => {
  const doc = db.prepare('SELECT id, owner_id FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (!canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
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

// publishing is "keeping" — full accounts only, and only the owner decides
// what of theirs becomes a public page
app.post('/api/docs/:id/publish', requireFullUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (doc.owner_id !== req.user.id) return res.status(403).json({ error: 'not yours' })
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
  // a comment on no page would haunt the log forever — no sweep ever finds it
  if (!docExists(req.params.id)) return res.status(404).json({ error: 'no such doc' })
  const { text, quote, suggestion, parent_id, id } = req.body || {}
  const note = String(text || '').trim()
  const parent = String(parent_id || '')
  // replies are words only; a top-level comment may instead be an edit
  const sugg = parent ? '' : String(suggestion || '')
  if (!note && !sugg.trim()) return res.status(400).json({ error: 'empty comment' })
  // a cut edit would later be applied cut — over the ceiling is a
  // refusal the reviewer sees, never a silent slice
  if (sugg.length > 5000)
    return res.status(400).json({ error: 'that edit is too long — keep it under 5,000 characters' })
  if (parent) {
    // one level deep, and only while the thread is still open — a reply
    // accepted anywhere else would be invisible in every view
    const p = db
      .prepare(
        "SELECT id FROM comments WHERE id = ? AND doc_id = ? AND parent_id = '' AND resolved = 0"
      )
      .get(parent, req.params.id)
    if (!p) return res.status(400).json({ error: 'that thread is settled' })
  }
  const cid = id || uid('c')
  // the comment and its history entry land together or not at all — a
  // half-written pair would be a note the desk never announces
  db.transaction(() => {
    db.prepare(
      'INSERT INTO comments (id, doc_id, user_id, username, quote, text, suggestion, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      cid,
      req.params.id,
      req.user.id,
      req.user.username,
      parent ? '' : String(quote || '').slice(0, 500),
      note,
      sugg,
      parent,
      Date.now()
    )
    addEvent(
      req.params.id,
      req.user,
      parent ? 'comment.reply' : sugg.trim() ? 'suggestion.add' : 'comment.add',
      sugg.trim() || note
    )
  })()
  res.json({ id: cid })
})

app.post('/api/comments/:cid/resolve', requireUser, (req, res) => {
  // cids are global and often client-chosen, so holding one proves nothing —
  // settling a thread hides it from review, and only a pen that can write
  // this doc gets to say the conversation is over
  const c = db
    .prepare('SELECT doc_id, quote, text, suggestion FROM comments WHERE id = ?')
    .get(req.params.cid)
  if (!c) return res.status(404).json({ error: 'no such comment' })
  const doc = db.prepare('SELECT id, owner_id FROM docs WHERE id = ?').get(c.doc_id)
  if (!doc || !canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
  // how the thread ended is part of the record: a suggested edit was taken
  // or it wasn't, and history tells them apart. a plain note just settles.
  const wanted = (req.body || {}).outcome
  const outcome =
    c.suggestion?.trim() && (wanted === 'accepted' || wanted === 'rejected') ? wanted : 'resolved'
  const type =
    outcome === 'accepted'
      ? 'suggestion.accept'
      : outcome === 'rejected'
        ? 'suggestion.reject'
        : 'comment.resolve'
  db.transaction(() => {
    db.prepare(
      'UPDATE comments SET resolved = 1, outcome = ?, resolved_by = ?, resolved_at = ? WHERE id = ?'
    ).run(outcome, req.user.username, Date.now(), req.params.cid)
    addEvent(c.doc_id, req.user, type, c.suggestion?.trim() || c.quote || c.text)
  })()
  res.json({ ok: true })
})

// ---------- versions ----------
// version history holds every auto-snapshot — passages later deleted from
// the page live on here, so only pens that can write the page may read its
// past (the review door invites readers the page's history wasn't shown to)
app.get('/api/docs/:id/versions', requireUser, (req, res) => {
  const doc = db.prepare('SELECT id, owner_id FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (!canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
  const rows = db
    .prepare(
      'SELECT id, name, username, created_at, kind FROM versions WHERE doc_id = ? ORDER BY created_at DESC'
    )
    .all(req.params.id)
  res.json(rows)
})

// saving a version is "keeping" — full accounts only, and only pens that
// can write this page (a version names itself into the history log, so an
// uninvited pen could otherwise speak in any doc's history)
app.post('/api/docs/:id/versions', requireFullUser, (req, res) => {
  const doc = db.prepare('SELECT id, owner_id FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (!canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
  const { name, content } = req.body || {}
  if (!content) return res.status(400).json({ error: 'no content' })
  // a deliberate save always wears a name, so it never blends in with the
  // automatic ones the panel titles by time alone
  const vid = insertVersion(
    req.params.id,
    String(name || '').trim() || 'unnamed version',
    req.user,
    JSON.stringify(content),
    Date.now(),
    'manual'
  )
  res.json({ id: vid })
})

app.get('/api/versions/:vid', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM versions WHERE id = ?').get(req.params.vid)
  if (!row) return res.status(404).json({ error: 'no such version' })
  // same gate as the list: a version's content is the page's past
  const doc = db.prepare('SELECT id, owner_id FROM docs WHERE id = ?').get(row.doc_id)
  if (!doc || !canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
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

// every uploaded-file reference in a blob of html or a header column
const FILE_URL_RE = new RegExp(
  `/files/[a-f0-9]{24}\\.(?:${Object.values(IMG_EXT).join('|')})`,
  'g'
)
function imageUrlsIn(html) {
  return String(html || '').match(FILE_URL_RE) || []
}

// only unlink a file once nothing else points at it — headers and inline
// images can be shared across docs by copy-paste, and the same names appear
// in other users' docs, so a blind unlink lets one user delete another's file
function unlinkIfOrphan(url, exceptDocId) {
  if (!url || !url.startsWith('/files/')) return
  const still = db
    .prepare(
      `SELECT 1 FROM docs
       WHERE id != ? AND (header_image = ? OR html LIKE ?) LIMIT 1`
    )
    .get(exceptDocId || '', url, `%${url}%`)
  if (still) return
  // version history counts as a referrer too — a restore must find its
  // pictures, so any kept version naming the file keeps the file (a deleted
  // doc's own versions are already gone by the time this runs)
  if (db.prepare('SELECT 1 FROM versions WHERE content LIKE ? LIMIT 1').get(`%${url}%`)) return
  const name = path.basename(url)
  fs.unlink(path.join(uploadsDir, name), () => {})
  // the copy goes with it, or a deleted page's picture outlives the page
  deleteImage(name).catch(() => {})
}
// a doc is going away entirely — drop every image it alone still holds
function unlinkDocImages(doc) {
  for (const url of new Set([doc.header_image, ...imageUrlsIn(doc.html)])) {
    unlinkIfOrphan(url, doc.id)
  }
}

// what this pen may do here: the owner owns, an enrolled collaborator wears
// their row's role, anyone else holding the doc id is an editor-in-waiting
// (the write link is the capability — opening it enrolls them as one)
function roleFor(doc, userId) {
  if (doc.owner_id === userId) return 'owner'
  const row = db
    .prepare('SELECT role FROM collaborators WHERE doc_id = ? AND user_id = ?')
    .get(doc.id, userId)
  return row ? row.role || 'editor' : null
}

// only the owner or someone enrolled to write may change the page — a
// commenter's pen stays in the margins
function canEditDoc(doc, userId) {
  const r = roleFor(doc, userId)
  return r === 'owner' || r === 'editor'
}

// shared receive-validate-store for both header and inline uploads;
// returns the /files/ url, or null after sending the error response itself
async function receiveImage(req, res) {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) {
    res.status(404).json({ error: 'no such doc' })
    return null
  }
  if (!canEditDoc(doc, req.user.id)) {
    res.status(403).json({ error: 'not yours' })
    return null
  }
  const ext = IMG_EXT[(req.headers['content-type'] || '').split(';')[0]]
  if (!ext || !magicOk(ext, req.body)) {
    res.status(400).json({ error: 'send a jpeg, png, webp, or gif' })
    return null
  }
  if (uploadsDirSize() > 500 * 1024 * 1024) {
    res.status(507).json({ error: 'image storage is full' })
    return null
  }
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(uploadsDir, name), req.body)
  // write-through: the second copy is made before the writer is told the name,
  // so no crash can strand a picture on a volume that isn't a backup. a bucket
  // having a bad day costs a backup, not the upload — the sweep will find it
  await putImage(name, req.body)
  return `/files/${name}`
}

app.post(
  '/api/docs/:id/header',
  requireUser,
  express.raw({ type: Object.keys(IMG_EXT), limit: '12mb' }),
  async (req, res) => {
    const url = await receiveImage(req, res)
    if (!url) return
    const prev = db.prepare('SELECT header_image FROM docs WHERE id = ?').get(req.params.id)
    db.prepare('UPDATE docs SET header_image = ? WHERE id = ?').run(url, req.params.id)
    unlinkIfOrphan(prev?.header_image, req.params.id)
    res.json({ url })
  }
)

// inline images pasted or dropped into the page — same rules as headers
app.post(
  '/api/docs/:id/images',
  requireUser,
  express.raw({ type: Object.keys(IMG_EXT), limit: '12mb' }),
  async (req, res) => {
    const url = await receiveImage(req, res)
    if (!url) return
    res.json({ url })
  }
)

app.delete('/api/docs/:id/header', requireUser, (req, res) => {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'no such doc' })
  if (!canEditDoc(doc, req.user.id)) return res.status(403).json({ error: 'not yours' })
  db.prepare('UPDATE docs SET header_image = NULL WHERE id = ?').run(doc.id)
  unlinkIfOrphan(doc.header_image, doc.id)
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
  // regulars: a desk of their own, but not (yet) paying for it
  const regulars = db
    .prepare(
      `SELECT COUNT(*) c FROM user u
       WHERE u.isAnonymous IS NOT 1
         AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id AND p.member = 1)`
    )
    .get().c
  const pages = db.prepare('SELECT COUNT(*) c FROM docs').get().c
  const published = db.prepare('SELECT COUNT(*) c FROM docs WHERE published = 1').get().c

  const recent = db
    .prepare(
      `SELECT u.username, u.email, u.createdAt, COALESCE(p.member, 0) member
       FROM user u LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.isAnonymous IS NOT 1 ORDER BY u.createdAt DESC LIMIT 20`
    )
    .all()

  // emails in the body — keep it out of every cache
  res.set('Cache-Control', 'no-store, private')
  res.json({ writers, ghosts, members, regulars, pages, published, words: totalWords(), recent })
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
          `SELECT title, slug, updated_at, html, header_image FROM docs
           WHERE owner_id = ? AND published = 1 AND on_profile = 1
           ORDER BY updated_at DESC`
        )
        .all(u.id)
        .map((a) => ({
          title: a.title,
          slug: a.slug,
          updated_at: a.updated_at,
          header_image: a.header_image || null,
          preview: previewOf(a.html),
        }))
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
  // the ledger keys this request will owe — settled by the handler only once
  // the model actually answers, so a provider failure burns no allowance
  const charges = [req.user.id]

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
    charges.push(ipKey)
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

  // the synthetic ip rows are shadows of ghost charges, not requests of
  // their own — counted here they'd spend the desk's budget twice per ghost
  const global = db
    .prepare(
      `SELECT COALESCE(SUM(count), 0) AS s FROM ai_usage
       WHERE day = ? AND user_id NOT LIKE 'ip:%'`
    )
    .get(day)
  if (global.s >= AI_GLOBAL_DAILY_CAP) {
    return res.status(429).json({ error: 'the pen rests — the whole desk hit its daily limit' })
  }
  // same promise as above: nothing is charged yet. the handler settles up at
  // the first sign of output, so an upstream 529 leaves the count untouched
  let settled = false
  req.settleAiCharge = () => {
    if (settled) return
    settled = true
    for (const key of charges) bumpUsage(key, day)
  }
  next()
}

app.post('/api/ai/feedback', requireUser, aiLimit, aiFeedback)
app.post('/api/ai/command', requireUser, aiLimit, aiCommand)
app.post('/api/ai/checks', requireUser, aiLimit, aiChecks)

// ---------- static client ----------
const dist = path.join(process.cwd(), 'dist')
// hashed assets cache forever; index.html must always revalidate so open
// tabs pick up new bundles on refresh
app.use(express.static(dist, { index: false, maxAge: '365d', immutable: true }))

// the SPA shell with its default og:/twitter: tags stripped, computed once —
// per-page share tags are spliced into the <head> at request time. guarded so
// a missing build (dev without `vite build`) doesn't crash the whole server;
// /p pages then just fall through to the plain shell.
let strippedShell = ''
try {
  strippedShell = fs
    .readFileSync(path.join(dist, 'index.html'), 'utf8')
    // whitespace-agnostic so it survives a future html-minify pass
    .replace(/[ \t]*<meta (?:property="og:|name="twitter:)[^>]*>\n?/g, '')
} catch {
  /* no build yet */
}
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// share cards for published pages: the site's default og:/twitter: tags are
// swapped for the article's own title, opening lines, and image (the header,
// or the first inline image, or none). crawlers read these from the raw html,
// so they must live in the shell, not be set by React after load.
function publishedShareTags(doc, origin) {
  const title = esc(doc.title || 'untitled') + ' · author*'
  const desc = esc(previewOf(doc.html, 200)) || 'a quiet place to write — together.'
  const rel = doc.header_image || (String(doc.html || '').match(FILE_URL_RE) || [])[0]
  const img = rel ? esc(origin + rel) : null
  const url = esc(`${origin}/p/${doc.slug}`)
  const card = img ? 'summary_large_image' : 'summary'
  const tags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="author*" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="${card}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
  ]
  if (img) {
    tags.push(`<meta property="og:image" content="${img}" />`)
    tags.push(`<meta name="twitter:image" content="${img}" />`)
  }
  return tags.join('\n    ')
}

app.get('/p/:slug', (req, res) => {
  const doc = db
    .prepare('SELECT title, slug, html, header_image FROM docs WHERE slug = ? AND published = 1')
    .get(req.params.slug)
  res.set('Cache-Control', 'no-cache')
  if (!doc || !strippedShell) return res.sendFile(path.join(dist, 'index.html'))
  const origin = (process.env.BETTER_AUTH_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
  const html = strippedShell.replace(
    '</head>',
    `    ${publishedShareTags(doc, origin)}\n  </head>`
  )
  res.type('html').send(html)
})

// share card for the public changelog — its own og image and copy, so a
// pasted /updates link unfurls as the changelog rather than the front door
app.get('/updates', (req, res) => {
  res.set('Cache-Control', 'no-cache')
  if (!strippedShell) return res.sendFile(path.join(dist, 'index.html'))
  const origin = esc(
    (process.env.BETTER_AUTH_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
  )
  const desc = 'what changed, as it changed. the public changelog — written as it was built.'
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="author*" />`,
    `<meta property="og:title" content="updates · author*" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${origin}/updates" />`,
    `<meta property="og:image" content="${origin}/og-updates.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="updates · author*" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${origin}/og-updates.png" />`,
  ].join('\n    ')
  res.type('html').send(strippedShell.replace('</head>', `    ${tags}\n  </head>`))
})

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
  // getUser awaits; a client that RSTs mid-await emits 'error' on a raw socket
  // that ws hasn't adopted yet. with no listener that becomes an
  // uncaughtException and takes the whole box down — every room's unsaved edits
  // with it. hold the socket until ws attaches its own handlers.
  const onUpgradeError = () => socket.destroy()
  socket.on('error', onUpgradeError)
  // sessions are cookie-based; the browser sends them on the ws handshake
  getUser(req.headers)
    .then((user) => {
      if (!user || !docExists(docId)) {
        socket.removeListener('error', onUpgradeError)
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        return socket.destroy()
      }
      // a commenter's socket reads the page and speaks presence, but its
      // writes never land — the margin is their surface, not the text
      const row = db
        .prepare('SELECT role FROM collaborators WHERE doc_id = ? AND user_id = ?')
        .get(docId, user.id)
      const readOnly = row?.role === 'commenter'
      wss.handleUpgrade(req, socket, head, (ws) => {
        socket.removeListener('error', onUpgradeError)
        setupCollab(ws, docId, { id: user.id, username: user.username }, readOnly)
      })
    })
    .catch(() => {
      socket.removeListener('error', onUpgradeError)
      socket.destroy()
    })
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
  let swept = 0
  for (const { id } of stale) {
    const docs = db.prepare('SELECT id, header_image, html FROM docs WHERE owner_id = ?').all(id)
    // updated_at only moves on save — a page reopened after a long sleep
    // looks stale until the first keystroke lands. a loaded room means
    // someone is there now; leave the whole ghost for a later night.
    if (docs.some((d) => hasRoom(d.id))) continue
    db.transaction(() => {
      for (const d of docs) purgeDocRows(d.id)
      db.prepare('DELETE FROM collaborators WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM read_cursors WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM activity WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM ai_usage WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM account WHERE userId = ?').run(id)
      db.prepare('DELETE FROM session WHERE userId = ?').run(id)
      db.prepare('DELETE FROM user WHERE id = ?').run(id)
    })()
    // rows gone first, so a file shared with another doc isn't unlinked
    for (const d of docs) unlinkDocImages(d)
    swept++
  }
  if (swept) console.log(`swept ${swept} drifted ghost(s)`)
}

const PORT = process.env.PORT || 3001
await runAuthMigrations()
await migrateLegacyUsers()
sweepGhosts()
// nightly by default; the knob is for tests, which can't wait a day
setInterval(sweepGhosts, Number(process.env.AUTHOR_SWEEP_MS) || 24 * 60 * 60 * 1000).unref()
server.listen(PORT, () => {
  console.log(`author* listening on http://localhost:${PORT}`)
})

// an upload the bucket refused, or a volume restored from an older replica,
// leaves pictures on disk with no copy behind them. heal them off the boot
// path — and again each hour, so a bucket that was down for a while catches up
if (imagesReplicated()) {
  const sweep = () =>
    pushMissing(uploadsDir)
      .then(({ uploaded, failed }) => {
        if (uploaded || failed) console.log(`images: pushed ${uploaded}, failed ${failed}`)
      })
      .catch((e) => console.error('image sweep failed', e.message))
  setTimeout(sweep, 5_000).unref()
  setInterval(sweep, 60 * 60 * 1000).unref()
}

// a deploy is just a very abrupt way of leaving — write everything down
// first (better-sqlite3 is synchronous, so this completes before exit)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    try {
      flushRooms()
    } catch (e) {
      // a failed flush is not a clean shutdown — say so in the exit code
      console.error('shutdown flush failed', e)
      process.exit(1)
    }
    process.exit(0)
  })
}

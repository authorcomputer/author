// the machine door: an MCP server at /mcp, so claude (or any client that
// speaks the protocol) can sit at a writer's desk — read their drafts and
// the margins, and start new pages. read-mostly by design: a machine never
// writes into a live room or speaks in the margins here; those stay pens
// and people. every request carries a bearer key minted in settings —
// hashed at rest like any other secret, revocable like any other key.
import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import { db } from './db.js'
import { cleanHtml } from './clean-html.js'

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const TOKENS_MAX = 5

// ---------- keys ----------
export function mintToken(userId, label) {
  const token = 'author_' + crypto.randomBytes(24).toString('hex')
  const id = 'tok_' + crypto.randomBytes(8).toString('hex')
  db.prepare(
    'INSERT INTO api_tokens (id, user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, sha(token), String(label || '').slice(0, 60), Date.now())
  return { id, token }
}

export const countTokens = (userId) =>
  db.prepare('SELECT COUNT(*) AS c FROM api_tokens WHERE user_id = ?').get(userId).c
export const tokensMax = () => TOKENS_MAX

export const listTokens = (userId) =>
  db
    .prepare(
      'SELECT id, label, created_at, last_used FROM api_tokens WHERE user_id = ? ORDER BY created_at'
    )
    .all(userId)

export function revokeToken(userId, id) {
  db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId)
}

// the bearer key names the writer; a spent minute between touches keeps
// the last_used stamp from costing a write per call
export function tokenUser(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')
  if (!m) return null
  const row = db
    .prepare(
      `SELECT t.id AS tid, u.id, u.username FROM api_tokens t
       JOIN user u ON u.id = t.user_id WHERE t.token_hash = ?`
    )
    .get(sha(m[1]))
  if (!row) return null
  db.prepare(
    'UPDATE api_tokens SET last_used = ? WHERE id = ? AND (last_used IS NULL OR last_used < ?)'
  ).run(Date.now(), row.tid, Date.now() - 60_000)
  return { id: row.id, username: row.username }
}

// ---------- the desk, seen through the wire ----------
const roleOf = (doc, userId) => {
  if (doc.owner_id === userId) return 'owner'
  const row = db
    .prepare('SELECT role FROM collaborators WHERE doc_id = ? AND user_id = ?')
    .get(doc.id, userId)
  return row ? row.role || 'editor' : null
}

// a machine-minted page: paragraphs into a real yjs doc, stored the same
// way the collab server stores every room (encodeStateAsUpdate in, applyUpdate out)
const mintSchema = getSchema([StarterKit])
function draftFromText(userId, title, text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const json = {
    type: 'doc',
    content: lines.length
      ? lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
      : [{ type: 'paragraph' }],
  }
  const ydoc = prosemirrorJSONToYDoc(mintSchema, json, 'default')
  ydoc.getMap('meta').set('title', title)
  const id = 'doc_' + crypto.randomBytes(8).toString('hex')
  const now = Date.now()
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  db.prepare(
    'INSERT INTO docs (id, owner_id, title, ydoc, html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    userId,
    String(title || 'untitled').slice(0, 300),
    Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    cleanHtml(lines.map((l) => `<p>${esc(l)}</p>`).join('')),
    now,
    now
  )
  return id
}

const TOOLS = [
  {
    name: 'list_drafts',
    description:
      "The writer's desk: every draft they own or have been let into, newest first. Returns id, title, timestamps, role, and the public url for published pieces.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_draft',
    description:
      'One draft in full: title and body (sanitized html — the same snapshot the published page would show). The id comes from list_drafts.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'a draft id from list_drafts' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_comments',
    description:
      'The margins of one draft: notes and suggested edits, who left them, replies, and how settled threads ended (accepted / rejected / resolved).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'a draft id from list_drafts' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_draft',
    description:
      "Start a new draft on the writer's desk from plain text (blank lines separate paragraphs). Returns the new draft's id and editor url. It does not publish or share anything.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'optional title' },
        text: { type: 'string', description: 'the body, plain text' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
]

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const refuse = (s) => ({ content: [{ type: 'text', text: s }], isError: true })

export function buildMcp(user) {
  const server = new Server({ name: 'author', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params

    if (name === 'list_drafts') {
      const rows = db
        .prepare(
          `SELECT d.id, d.title, d.updated_at, d.created_at, d.published, d.slug, d.owner_id
           FROM docs d
           WHERE d.owner_id = ? OR d.id IN (SELECT doc_id FROM collaborators WHERE user_id = ?)
           ORDER BY d.updated_at DESC LIMIT 200`
        )
        .all(user.id, user.id)
      return text(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          role: roleOf({ id: r.id, owner_id: r.owner_id }, user.id),
          updated_at: new Date(r.updated_at).toISOString(),
          created_at: new Date(r.created_at).toISOString(),
          ...(r.published && r.slug ? { published_url: `https://author.computer/p/${r.slug}` } : {}),
        }))
      )
    }

    if (name === 'read_draft' || name === 'read_comments') {
      const doc = db.prepare('SELECT * FROM docs WHERE id = ?').get(String(args.id || ''))
      // a stranger's guess and a missing page answer alike
      if (!doc || !roleOf(doc, user.id)) return refuse('no such draft on this desk')
      if (name === 'read_draft')
        return text({ id: doc.id, title: doc.title, html: doc.html || '' })
      const comments = db
        .prepare('SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at ASC')
        .all(doc.id)
      return text(
        comments.map((c) => ({
          by: c.username,
          quote: c.quote || undefined,
          text: c.text || undefined,
          suggested_replacement: c.suggestion || undefined,
          reply_to: c.parent_id || undefined,
          settled: c.resolved ? c.outcome || 'resolved' : false,
          at: new Date(c.created_at).toISOString(),
        }))
      )
    }

    if (name === 'create_draft') {
      if (typeof args.text !== 'string') return refuse('text is required — the body, plain')
      if (args.text.length > 200_000) return refuse('that page is too long for one breath')
      const title = String(args.title || '').trim() || 'untitled'
      const id = draftFromText(user.id, title, args.text)
      return text({ id, title, editor_url: `https://author.computer/d/${id}` })
    }

    return refuse(`no tool named ${name}`)
  })
  return server
}

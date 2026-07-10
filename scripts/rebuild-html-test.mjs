// The rebuild script is the third writer of docs.html, after POST /html and
// /publish — and it must obey the same sanitizer, because Y.XmlText.toString()
// does not escape angle brackets: markup a writer quotes in prose comes out of
// the yjs state as live tags. Build a real docs table around a doc whose body
// text quotes an <img> and an <iframe>, run the script, and read back what the
// public page would render.
import path from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import * as Y from 'yjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const scratch = path.join(root, 'node_modules', '.cache', 'rebuild-html-test')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(path.join(scratch, 'data'), { recursive: true })

const ydoc = new Y.Doc()
const frag = ydoc.getXmlFragment('default')
const h = new Y.XmlElement('heading')
h.setAttribute('level', '2')
h.insert(0, [new Y.XmlText('quoting html in prose')])
const p = new Y.XmlElement('paragraph')
p.insert(0, [
  new Y.XmlText(
    'the tag <img src=//evil.example/beacon> and <iframe src="https://evil.example/"></iframe> are just words here'
  ),
])
frag.insert(0, [h, p])

// a second doc holds real media atoms — an uploaded image and a provider embed
// — exactly as y-prosemirror stores them: attributes, no children. these must
// come back through the gate as live <img>/<iframe>, not be stripped.
const mediaId = '/files/' + 'a'.repeat(24) + '.png'
const embedSrc = 'https://www.youtube-nocookie.com/embed/abcdefghijk'
const mdoc = new Y.Doc()
const mfrag = mdoc.getXmlFragment('default')
const mp = new Y.XmlElement('paragraph')
mp.insert(0, [new Y.XmlText('words around media')])
const img = new Y.XmlElement('image')
img.setAttribute('src', mediaId)
img.setAttribute('alt', 'a cat')
const emb = new Y.XmlElement('embed')
emb.setAttribute('src', embedSrc)
emb.setAttribute('provider', 'youtube')
mfrag.insert(0, [mp, img, emb])

const db = new Database(path.join(scratch, 'data', 'author.db'))
db.exec('CREATE TABLE docs (id TEXT PRIMARY KEY, ydoc BLOB, html TEXT DEFAULT \'\')')
const insert = db.prepare('INSERT INTO docs (id, ydoc) VALUES (?, ?)')
insert.run('doc_quoted', Buffer.from(Y.encodeStateAsUpdate(ydoc)))
insert.run('doc_media', Buffer.from(Y.encodeStateAsUpdate(mdoc)))
db.close()

// AUTHOR_REBUILD_SCRIPT lets the negative control aim the same asserts at a
// scratch copy of the pre-fix script; default is the tree's own.
const script = process.env.AUTHOR_REBUILD_SCRIPT || path.join(root, 'scripts', 'rebuild-html.mjs')
const rebuild = (id) => {
  // the script opens data/author.db relative to cwd, exactly how an operator runs it
  const run = spawnSync('node', [script, id], { cwd: scratch, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`FAIL: rebuild script exited ${run.status}\n${run.stderr}`)
  return new Database(path.join(scratch, 'data', 'author.db'), { readonly: true })
    .prepare('SELECT html FROM docs WHERE id = ?')
    .get(id).html
}

const html = rebuild('doc_quoted')

const ok = (label, cond, ctx = html) => {
  if (!cond) throw new Error(`FAIL: ${label}\n  html: ${ctx}`)
  console.log(`PASS: ${label}`)
}

ok('quoted <img> in prose does not become a live tag', !/<img\b/i.test(html))
ok('quoted <iframe> in prose does not become a live tag', !/<iframe\b/i.test(html))
ok('block structure survives the gate', /<h2>/.test(html) && /<p>/.test(html))
ok('the prose around the quoted tags is kept', html.includes('are just words here'))

const media = rebuild('doc_media')

// these are the assertions the negative control must break on the pre-fix script
ok('an image node rebuilds to a live <img> at its /files src', new RegExp(`<img\\b[^>]*src="${mediaId}"`, 'i').test(media), media)
ok('the image survives the gate (src matches the /files allowlist)', media.includes(`src="${mediaId}"`), media)
ok('an embed node rebuilds to a live provider <iframe>', new RegExp(`<iframe\\b[^>]*src="${embedSrc}"`, 'i').test(media), media)
ok('the embed carries data-provider, not the raw provider attr', /<iframe\b[^>]*data-provider="youtube"/i.test(media) && !/\sprovider="youtube"/i.test(media), media)
ok('the prose around the media is kept', media.includes('words around media'), media)

console.log('rebuild-html-test: all good')

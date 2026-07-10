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

const db = new Database(path.join(scratch, 'data', 'author.db'))
db.exec('CREATE TABLE docs (id TEXT PRIMARY KEY, ydoc BLOB, html TEXT DEFAULT \'\')')
db.prepare('INSERT INTO docs (id, ydoc) VALUES (?, ?)').run(
  'doc_quoted',
  Buffer.from(Y.encodeStateAsUpdate(ydoc))
)
db.close()

// the script opens data/author.db relative to cwd, exactly how an operator runs it
const run = spawnSync('node', [path.join(root, 'scripts', 'rebuild-html.mjs'), 'doc_quoted'], {
  cwd: scratch,
  encoding: 'utf8',
})
if (run.status !== 0) throw new Error(`FAIL: rebuild script exited ${run.status}\n${run.stderr}`)

const html = new Database(path.join(scratch, 'data', 'author.db'), { readonly: true })
  .prepare('SELECT html FROM docs WHERE id = ?')
  .get('doc_quoted').html

const ok = (label, cond) => {
  if (!cond) throw new Error(`FAIL: ${label}\n  html: ${html}`)
  console.log(`PASS: ${label}`)
}

ok('quoted <img> in prose does not become a live tag', !/<img\b/i.test(html))
ok('quoted <iframe> in prose does not become a live tag', !/<iframe\b/i.test(html))
ok('block structure survives the gate', /<h2>/.test(html) && /<p>/.test(html))
ok('the prose around the quoted tags is kept', html.includes('are just words here'))

console.log('rebuild-html-test: all good')

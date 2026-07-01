// Rebuild a doc's html snapshot from its stored Yjs state (approximate mapping
// of tiptap node names to HTML; the exact html is re-pushed next time the doc
// is opened in the editor).
import Database from 'better-sqlite3'
import * as Y from 'yjs'

const docId = process.argv[2]
const db = new Database('data/author.db')
const row = db.prepare('SELECT ydoc FROM docs WHERE id = ?').get(docId)
if (!row?.ydoc) {
  console.error('no ydoc for', docId)
  process.exit(1)
}
const ydoc = new Y.Doc()
Y.applyUpdate(ydoc, new Uint8Array(row.ydoc))
let xml = ydoc.getXmlFragment('default').toString()

xml = xml
  .replace(/<heading level="1">/g, '<h1>').replace(/<\/heading>/g, '</h_close>')
  .replace(/<heading level="2">/g, '<h2>')
  .replace(/<heading level="3">/g, '<h3>')
  .replace(/<heading[^>]*>/g, '<h3>')
// close headings: we lost which level — instead do a proper sequential pass
xml = ydoc.getXmlFragment('default').toString()
const html = xml
  .replace(/<heading level="(\d)"[^>]*>([\s\S]*?)<\/heading>/g, (_, l, inner) => {
    const lvl = Math.min(3, Math.max(1, Number(l)))
    return `<h${lvl}>${inner}</h${lvl}>`
  })
  .replace(/<(\/?)paragraph>/gi, '<$1p>')
  .replace(/<(\/?)bulletlist>/gi, '<$1ul>')
  .replace(/<(\/?)orderedlist>/gi, '<$1ol>')
  .replace(/<(\/?)listitem>/gi, '<$1li>')
  .replace(/<(\/?)codeblock[^>]*>/gi, '<$1pre>')
  .replace(/<horizontalrule><\/horizontalrule>/gi, '<hr>')
  .replace(/<hardbreak><\/hardbreak>/gi, '<br>')
  .replace(/<(\/?)bold>/g, '<$1strong>')
  .replace(/<(\/?)italic>/g, '<$1em>')
  .replace(/<(\/?)strike>/g, '<$1s>')

db.prepare('UPDATE docs SET html = ? WHERE id = ?').run(html, docId)
console.log('rebuilt html snapshot for', docId, '—', html.slice(0, 120))

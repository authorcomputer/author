// Range hunting (client/src/ranges.ts), tested pure: real ProseMirror docs,
// no DOM. Everything that rewrites text holds one invariant — a hunted
// range either covers the whole passage or comes back null. A prefix match
// applied as a replacement leaves the tail of the old sentence duplicated
// after the new words, silently, in a shared doc.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'ranges-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [
    path.join(root, 'client/src/ranges.ts'),
    path.join(root, 'client/src/comment-mark.ts'),
  ],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})

const { getSchema } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { default: TiptapImage } = await import('@tiptap/extension-image')
const { findRange, findWholeRange, commentRange } = await import(path.join(cache, 'ranges.js'))
const { CommentMark } = await import(path.join(cache, 'comment-mark.js'))

const schema = getSchema([StarterKit.configure({ history: false }), TiptapImage, CommentMark])
const bold = schema.marks.bold.create()
const cm = (id) => schema.marks.comment.create({ id })
const t = (s, ...marks) => schema.text(s, marks)
const p = (...kids) => schema.node('paragraph', null, kids)
const ed = (...blocks) => ({ state: { doc: schema.node('doc', null, blocks) } })
const textOf = (e, r) => e.state.doc.textBetween(r.from, r.to, '\n\n')

const ok = (label, cond) => {
  if (!cond) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

// the invariant every replacement path leans on: whatever the hunt returns
// must span the passage exactly, or the caller must be told there is none
function whole(e, needle) {
  const r = findWholeRange(e, needle)
  return r === null || textOf(e, r) === needle
}

// the proof-panel scenario: one bolded word splits the sentence across
// text nodes, so the full excerpt never matches inside a single node
{
  const excerpt = 'It was the best of times, but it was also the worst of them'
  const e = ed(p(t('It was the best of times, but it was '), t('also', bold), t(' the worst of them')))
  ok('a split excerpt still prefix-matches for pointing', !!findRange(e, excerpt))
  ok('incorporate refuses a prefix rather than duplicating the tail', whole(e, excerpt))
}

// an unsplit excerpt is still found whole — refusal is for prefixes only
{
  const excerpt = 'the ending drags'
  const e = ed(p(t('this bit sings, but the ending drags a little')))
  const r = findWholeRange(e, excerpt)
  ok('a clean excerpt is found whole', r && textOf(e, r) === excerpt)
}

// apply edit with the anchor mark gone: the quote survives in the page but
// a link mid-way splits it — the hunt must not hand back the first 24 chars
{
  const quote = 'the committee met on tuesday and resolved nothing at all'
  const e = ed(p(t('the committee met on '), t('tuesday', bold), t(' and resolved nothing at all')))
  const r = commentRange(e, { id: 'c_gone', quote })
  ok('an unanchored quote is matched whole or not at all', r === null || textOf(e, r) === quote)
}

// the mark's own span survives inline splits — first start to last end
{
  const e = ed(
    p(t('before. '), t('the ending ', cm('c1')), t('drags', cm('c1'), bold), t(' badly', cm('c1')), t(' after'))
  )
  const r = commentRange(e, { id: 'c1', quote: 'the ending drags badly' })
  ok('a bold inside the passage does not tear the span', r && textOf(e, r) === 'the ending drags badly')
}

// a passage across a paragraph break is still one span — the boundary
// holds no content, so nothing between the pieces is at risk
{
  const e = ed(p(t('end of one', cm('c2'))), p(t('start of two', cm('c2'))))
  const r = commentRange(e, { id: 'c2', quote: 'end of one start of two' })
  ok('a paragraph break inside the passage does not tear the span', r && textOf(e, r) === 'end of one\n\nstart of two')
}

// the drag-move scenario: half the passage (mark included) now lives three
// paragraphs down — a first-to-last span would swallow everything between
{
  const e = ed(
    p(t('the first half of the sentence', cm('c3'))),
    p(t('an unrelated paragraph about weather')),
    p(t('another about the sea')),
    p(t('and the moved second half', cm('c3')))
  )
  const r = commentRange(e, { id: 'c3', quote: 'the first half of the sentence and the moved second half' })
  ok('a torn mark never spans the unrelated content between its pieces', r === null || !textOf(e, r).includes('weather'))
}

// an image drifted between the pieces counts as content too
{
  const img = schema.node('image', { src: 'x.png' })
  const e = ed(p(t('one half ', cm('c4'))), img, p(t(' other half', cm('c4'))))
  let imgPos = -1
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') imgPos = pos
  })
  const r = commentRange(e, { id: 'c4', quote: 'one half  other half' })
  ok('an image between the pieces tears the span', r === null || r.to <= imgPos || r.from > imgPos)
}

console.log('ALL PASS')
process.exit(0)

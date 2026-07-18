// The history diff, tested pure (client/src/diff.ts): stored-version JSON
// in, changed blocks out. No DOM, no editor — the panel must tell the truth
// about what a sitting changed, so the walk and the LCS get their own desk.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'diff-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [path.join(root, 'client/src/diff.ts')],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})
const { blockTexts, diffBlocks } = await import(path.join(cache, 'diff.js'))

let failed = 0
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failed = 1
}

const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const h = (text) => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })

// ---- blockTexts ----
const walked = blockTexts(
  doc(
    h('the title'),
    p('one paragraph'),
    p(''),
    { type: 'image', attrs: { src: '/files/x.jpg' } },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p('first errand')] },
        { type: 'listItem', content: [p('second errand')] },
      ],
    }
  )
)
ok(
  JSON.stringify(walked) ===
    JSON.stringify(['the title', 'one paragraph', '[ image ]', '· first errand', '· second errand']),
  'blocks walk whole: headings, prose, media, list items — empties dropped'
)
// inline marks split words across text nodes; they must rejoin seamlessly
const marked = blockTexts({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 're' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'ally' },
      ],
    },
  ],
})
ok(marked[0] === 'really', 'a bold mid-word does not split the word')
// a line break separates its neighbors; it never fuses them
const broken = blockTexts({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'end of verse one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'start of verse two' },
      ],
    },
  ],
})
ok(broken[0] === 'end of verse one start of verse two', 'a line break keeps its neighbors apart')
// a quote's paragraphs are their own blocks — one edited line must not
// mark the whole quote changed
const quoted = blockTexts(
  doc({ type: 'blockquote', content: [p('first line of the quote'), p('second line')] })
)
ok(
  JSON.stringify(quoted) === JSON.stringify(['first line of the quote', 'second line']),
  'a blockquote walks paragraph by paragraph'
)

// ---- diffBlocks ----
ok(diffBlocks(['a', 'b'], ['a', 'b']).length === 0, 'no change tells no story')
ok(
  JSON.stringify(diffBlocks(['a', 'b', 'c'], ['a', 'x', 'c'])) ===
    JSON.stringify([
      { kind: 'old', text: 'b' },
      { kind: 'new', text: 'x' },
    ]),
  'a reworked block reads old-then-new'
)
ok(
  JSON.stringify(diffBlocks(['a', 'c'], ['a', 'b', 'c'])) ===
    JSON.stringify([{ kind: 'new', text: 'b' }]),
  'an inserted block arrives alone'
)
ok(
  JSON.stringify(diffBlocks(['a', 'b', 'c'], ['a', 'c'])) ===
    JSON.stringify([{ kind: 'old', text: 'b' }]),
  'a removed block leaves alone'
)
ok(
  JSON.stringify(diffBlocks([], ['a', 'b'])) ===
    JSON.stringify([
      { kind: 'new', text: 'a' },
      { kind: 'new', text: 'b' },
    ]),
  'a first sitting is all arrivals'
)
// a repeated block must not confuse the thread
const rep = diffBlocks(['x', 'x', 'y'], ['x', 'y', 'x'])
ok(
  rep.every((r) => r.text === 'x') && rep.length === 2,
  'repeats resolve to the fewest moves'
)
// the cap holds: two big different docs return without hanging
const big1 = Array.from({ length: 900 }, (_, i) => `left ${i}`)
const big2 = Array.from({ length: 900 }, (_, i) => `right ${i}`)
const t0 = Date.now()
const bigDiff = diffBlocks(big1, big2)
ok(Date.now() - t0 < 3000 && bigDiff.length === 1800, 'a monstrous page diffs without freezing')

process.exit(failed)

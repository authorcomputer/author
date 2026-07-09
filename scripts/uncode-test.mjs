// The door out of a pasted code block (client/src/uncode.ts), tested pure:
// EditorStates only, no DOM. A copied report arrives as <pre> and becomes
// one giant code block; clicking code must dissolve it into real
// paragraphs — one per line, blank lines dropped — wherever the caret or
// selection sits, and must leave everything else for the inline mark.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'uncode-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [path.join(root, 'client/src/uncode.ts')],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})

const { getSchema } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { EditorState, TextSelection, AllSelection } = await import('@tiptap/pm/state')
const { uncodeBlocks } = await import(path.join(cache, 'uncode.js'))

const schema = getSchema([StarterKit.configure({ history: false })])
const p = (t) => (t ? schema.node('paragraph', null, schema.text(t)) : schema.node('paragraph'))
const code = (t) => schema.node('codeBlock', null, t ? schema.text(t) : undefined)
const state = (...blocks) =>
  EditorState.create({ schema, doc: schema.node('doc', null, blocks) })

function apply(st, select) {
  let tr = st.tr
  if (select === 'all') tr = tr.setSelection(new AllSelection(st.doc)) // what cmd+A really makes
  else if (typeof select === 'number') tr = tr.setSelection(TextSelection.create(st.doc, select))
  const withSel = st.apply(tr)
  const out = withSel.tr
  const changed = uncodeBlocks(withSel, out)
  return { changed, doc: withSel.apply(out).doc }
}

const types = (doc) => doc.content.content.map((n) => `${n.type.name}:${n.textContent}`)
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    throw new Error(`FAIL: ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
  console.log(`PASS: ${label}`)
}

// the report scenario: whole doc is one code block, cmd+A, click code
{
  const st = state(code('# Title\n\n**bold claim**\n\n- a list line'))
  const { changed, doc } = apply(st, 'all')
  if (!changed) throw new Error('FAIL: select-all did not dissolve')
  eq('select-all dissolves to one paragraph per line, blanks dropped', types(doc), [
    'paragraph:# Title',
    'paragraph:**bold claim**',
    'paragraph:- a list line',
  ])
}

// caret parked inside the block, no selection — still finds the door
{
  const st = state(code('line one\nline two'))
  const { changed, doc } = apply(st, 3)
  if (!changed) throw new Error('FAIL: caret inside block did not dissolve')
  eq('caret inside dissolves the whole block', types(doc), [
    'paragraph:line one',
    'paragraph:line two',
  ])
}

// mixed page: prose stays put, both blocks dissolve, bottom-up mapping holds
{
  const st = state(p('before'), code('a\nb'), p('between'), code('c'), p('after'))
  const { changed, doc } = apply(st, 'all')
  if (!changed) throw new Error('FAIL: mixed selection did not dissolve')
  eq('mixed selection dissolves every block, prose untouched', types(doc), [
    'paragraph:before',
    'paragraph:a',
    'paragraph:b',
    'paragraph:between',
    'paragraph:c',
    'paragraph:after',
  ])
}

// no code block anywhere: report false so the button toggles the mark
{
  const st = state(p('just prose'))
  const { changed, doc } = apply(st, 'all')
  if (changed) throw new Error('FAIL: claimed to dissolve prose')
  eq('prose-only selection falls through untouched', types(doc), ['paragraph:just prose'])
}

// an empty code block leaves an empty paragraph, not a hole
{
  const st = state(code(''))
  const { changed, doc } = apply(st, 1)
  if (!changed) throw new Error('FAIL: empty block did not dissolve')
  eq('empty block becomes an empty paragraph', types(doc), ['paragraph:'])
}

console.log('ALL PASS')
process.exit(0)

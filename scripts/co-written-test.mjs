// Pressure test for the "✽ written twice" note (client/src/co-written.ts).
//
// Two ProseMirror EditorStates stand in for two people's editors. Every
// edit is applied twice: to its author's state as a plain local
// transaction, and to the other state tagged with y-prosemirror's
// isChangeOrigin meta — the exact signal the plugin uses to tell a
// collaborator's change from the local pen. Both application paths reuse
// the node objects of untouched blocks (PM docs are persistent
// structures), which is the identity property the plugin's diff rides on.
// No DOM, no websocket: the plugin is pure state, so pure state tests it.
//
// The scenarios that matter are the review-loop ones between two people:
// comments placed, threads resolved (mark swept by either or both sides),
// suggested edits applied. Marks coming and going rebuild paragraph nodes
// without writing a word — the note must not mistake them for a pen.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// the plugin lives in client TS — compile it (and the comment mark) to
// something node can import, with deps external so module identity
// (plugin keys, schema classes) stays single
const cache = path.join(root, 'node_modules', '.cache', 'co-written-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [
    path.join(root, 'client/src/co-written.ts'),
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
const { EditorState } = await import('@tiptap/pm/state')
const { ySyncPluginKey } = await import('y-prosemirror')
const { coWrittenPlugin, coWrittenKey } = await import(
  path.join(cache, 'co-written.js')
)
const { CommentMark } = await import(path.join(cache, 'comment-mark.js'))

const schema = getSchema([StarterKit.configure({ history: false }), CommentMark])

// two states, every edit landing on both — locally for its author,
// remote-tagged for the other side, like the wire would deliver it
function makePair(initial = []) {
  // paragraphs passed here are the page as it already stood — older than
  // the collision window, nobody's recent pen
  const fresh = () => {
    const doc = initial.length
      ? schema.node('doc', null, initial.map((t) => schema.node('paragraph', null, schema.text(t))))
      : undefined
    let st = EditorState.create({ schema, doc, plugins: [coWrittenPlugin()] })
    const tr = st.tr.setMeta(coWrittenKey, { others: 1 }) // a second pen is present
    return st.apply(tr)
  }
  const states = { ink: fresh(), quill: fresh() }
  const other = (by) => (by === 'ink' ? 'quill' : 'ink')
  return {
    // mutate takes (tr, state) and edits at positions valid in both
    // states — they are kept structurally identical
    edit(by, mutate) {
      const mine = states[by].tr
      mutate(mine, states[by])
      states[by] = states[by].apply(mine)
      const theirs = states[other(by)].tr
      mutate(theirs, states[other(by)])
      theirs.setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: false })
      states[other(by)] = states[other(by)].apply(theirs)
    },
    state: (who) => states[who],
  }
}

// ---- the pens ----
const addParagraph = (pair, by, text) =>
  pair.edit(by, (tr, st) =>
    tr.insert(tr.doc.content.size, st.schema.nodes.paragraph.create(null, st.schema.text(text)))
  )
const rangeOf = (st, needle) => {
  let r = null
  st.doc.descendants((node, pos) => {
    if (node.isText && !r && node.text.includes(needle))
      r = { from: pos + node.text.indexOf(needle), to: pos + node.text.indexOf(needle) + needle.length }
  })
  if (!r) throw new Error(`"${needle}" not found`)
  return r
}
const type = (pair, by, after, text) =>
  pair.edit(by, (tr, st) => tr.insertText(text, rangeOf(st, after).to))
// leave a comment on a passage, the way the composer does
const comment = (pair, by, needle, id) =>
  pair.edit(by, (tr, st) => {
    const { from, to } = rangeOf(st, needle)
    tr.addMark(from, to, st.schema.marks.comment.create({ id, kind: 'note' }))
  })
// what Editor.tsx's resolve/sweep does: strip the mark wherever it lives
const sweep = (pair, by, id) =>
  pair.edit(by, (tr, st) => {
    st.doc.descendants((node, pos) => {
      node.marks.forEach((m) => {
        if (m.type.name === 'comment' && m.attrs.id === id)
          tr.removeMark(pos, pos + node.nodeSize, st.schema.marks.comment)
      })
    })
  })
// replace a passage with other words, the way applySuggestion does
const replace = (pair, by, needle, text) =>
  pair.edit(by, (tr, st) => {
    const { from, to } = rangeOf(st, needle)
    tr.insertText(text, from, to)
  })

// formatting is real ink — bold a passage the way the bubble menu would
const bold = (pair, by, needle) =>
  pair.edit(by, (tr, st) => {
    const { from, to } = rangeOf(st, needle)
    tr.addMark(from, to, st.schema.marks.bold.create())
  })
// restructure a block — paragraph to heading
const toHeading = (pair, by, needle) =>
  pair.edit(by, (tr, st) => {
    let at = null
    st.doc.forEach((node, offset) => {
      if (at === null && node.textContent.includes(needle)) at = offset
    })
    tr.setNodeMarkup(at, st.schema.nodes.heading, { level: 2 })
  })

// the plugin reads Date.now() — let the test walk the clock forward
const realNow = Date.now.bind(Date)
let skew = 0
Date.now = () => realNow() + skew
const elapse = (ms) => (skew += ms)

// which paragraphs wear the note right now
const noted = (st) => {
  const plug = coWrittenKey.getState(st)
  const out = []
  st.doc.forEach((node) => {
    if (plug.marked.has(node)) out.push(node.textContent.slice(0, 32))
  })
  return out
}

// ---- the scenarios ----
let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '  ok ' : 'FAIL '} ${name}${cond || !detail ? '' : ` — noted: ${detail}`}`)
  if (!cond) failed++
}
const scenario = (name, fn, initial = []) => {
  console.log(`\n· ${name}`)
  fn(makePair(initial))
}
const quietOn = (pair, who) =>
  check(`no note for ${who}`, noted(pair.state(who)).length === 0, noted(pair.state(who)).join('; '))
const notedOn = (pair, who) => check(`note for ${who}`, noted(pair.state(who)).length > 0)

scenario('two pens in different paragraphs stay quiet', (pair) => {
  addParagraph(pair, 'ink', 'ink writes the opening here')
  addParagraph(pair, 'quill', 'quill drafts the closing there')
  type(pair, 'ink', 'opening here', ' and on')
  type(pair, 'quill', 'closing there', ' at length')
  quietOn(pair, 'ink')
  quietOn(pair, 'quill')
})

scenario('two pens in the same paragraph wear the note', (pair) => {
  addParagraph(pair, 'ink', 'a shared paragraph both pens rework')
  type(pair, 'ink', 'rework', ' — ink adds')
  type(pair, 'quill', 'rework', ' — quill too')
  notedOn(pair, 'ink')
  notedOn(pair, 'quill')
})

scenario('a comment placed on fresh writing is not a pen', (pair) => {
  addParagraph(pair, 'ink', 'ink types a sentence quill will note')
  type(pair, 'ink', 'will note', ' just now')
  comment(pair, 'quill', 'a sentence', 'c1') // quill comments — words untouched
  quietOn(pair, 'ink')
  quietOn(pair, 'quill')
})

scenario('one side resolving a thread is not a pen', (pair) => {
  addParagraph(pair, 'ink', 'a passage with an open thread on it')
  comment(pair, 'ink', 'open thread', 'c2')
  type(pair, 'ink', 'on it', ' — ink keeps going')
  sweep(pair, 'quill', 'c2') // quill resolves; the mark comes off
  quietOn(pair, 'ink')
  quietOn(pair, 'quill')
})

scenario('both sides sweeping the same settled thread stays quiet', (pair) => {
  addParagraph(pair, 'ink', 'both clients race to sweep this mark')
  comment(pair, 'ink', 'race to sweep', 'c3')
  // the poll fires on both sides before either sweep syncs — both dispatch
  sweep(pair, 'ink', 'c3')
  sweep(pair, 'quill', 'c3')
  quietOn(pair, 'ink')
  quietOn(pair, 'quill')
})

scenario(
  'resolving beside the other pen’s typing stays quiet',
  (pair) => {
    // the paragraph is old — only quill's pen moves in it now
    comment(pair, 'quill', 'stands here', 'c4')
    sweep(pair, 'ink', 'c4') // ink resolves on their own screen…
    type(pair, 'quill', 'a thread', ' — quill continues') // …quill keeps writing
    quietOn(pair, 'ink')
    quietOn(pair, 'quill')
  },
  ['an old paragraph stands here while quill settles a thread']
)

scenario('an applied suggestion is a real second pen', (pair) => {
  addParagraph(pair, 'ink', 'ink drafts a passage quill will rewrite outright')
  type(pair, 'ink', 'outright', ' hastily')
  replace(pair, 'quill', 'drafts a passage', 'rewrote every word') // apply edit
  notedOn(pair, 'ink')
})

scenario('formatting the other pen’s fresh words is a pen', (pair) => {
  addParagraph(pair, 'ink', 'ink types words quill immediately bolds')
  type(pair, 'ink', 'bolds', ' now')
  bold(pair, 'quill', 'types words') // not a comment — real ink
  notedOn(pair, 'ink')
  notedOn(pair, 'quill')
})

scenario('restructuring the other pen’s fresh paragraph is a pen', (pair) => {
  addParagraph(pair, 'ink', 'ink types a line quill turns into a heading')
  type(pair, 'ink', 'a heading', ' at once')
  toHeading(pair, 'quill', 'turns into')
  notedOn(pair, 'ink')
  notedOn(pair, 'quill')
})

scenario('a comment batched with writing elsewhere is still not a pen', (pair) => {
  addParagraph(pair, 'ink', 'ink writes a paragraph quill will note in passing')
  type(pair, 'ink', 'in passing', ' today')
  // one sync frame can carry both: the comment on ink's paragraph and a
  // brand-new paragraph — the changed region loses its shape
  pair.edit('quill', (tr, st) => {
    const { from, to } = rangeOf(st, 'a paragraph')
    tr.addMark(from, to, st.schema.marks.comment.create({ id: 'c8', kind: 'note' }))
    tr.insert(tr.doc.content.size, st.schema.nodes.paragraph.create(null, st.schema.text('quill starts a fresh thought')))
  })
  quietOn(pair, 'ink')
  quietOn(pair, 'quill')
})

scenario('a stale note fades when a thread is swept later', (pair) => {
  addParagraph(pair, 'ink', 'a real collision that later goes quiet')
  type(pair, 'ink', 'goes quiet', ' — ink')
  type(pair, 'quill', 'goes quiet', ' — quill')
  notedOn(pair, 'ink') // the collision is real…
  comment(pair, 'quill', 'real collision', 'c9')
  elapse(31_000) // …then everyone moves on
  sweep(pair, 'ink', 'c9') // settling the thread is the next touch — fade
  quietOn(pair, 'ink')
  quietOn(pair, 'quill')
})

console.log(failed ? `\n${failed} check(s) FAILED` : '\nPASS: the note knows a pen from a mark')
process.exit(failed ? 1 : 0)

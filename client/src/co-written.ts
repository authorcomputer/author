// "✽ written twice" — a quiet margin note on paragraphs that two pens
// rewrote at the same time. CRDTs merge concurrent edits syntactically but
// nobody reads the result; this at least points at where to look.
//
// Pure decorations, like checkmarks: nothing touches the document or the
// Yjs state, so the note is local, ephemeral, and vanishes on reload. A
// paragraph is "written twice" when a local edit and a remote edit land in
// it within WINDOW of each other; the note fades once the next edit arrives
// after the collision has gone quiet.
//
// Why block identity instead of step maps: y-prosemirror applies every
// remote update as one whole-document ReplaceStep, so step maps say
// "everything changed" and mapped decorations are wiped. But it reuses the
// PM node objects of untouched blocks (and local edits do too, PM docs
// being persistent structures), so the blocks that really changed are
// exactly the ones whose object identity is new — found by trimming the
// common prefix/suffix of the before/after child lists.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'

const WINDOW = 30_000

type CoState = {
  others: number // collaborators actually present — no second pen, no note
  local: Map<PMNode, number> // block -> when my pen last touched it
  remote: Map<PMNode, number> // block -> when their pen last touched it
  marked: Map<PMNode, number> // block -> when the pens last collided
  decos: DecorationSet
}

export const coWrittenKey = new PluginKey<CoState>('co-written')

const children = (doc: PMNode) => {
  const out: PMNode[] = []
  doc.forEach((n) => out.push(n))
  return out
}

// blocks whose node identity changed between docs, plus old->new pairings
// (index-aligned when the changed region kept its shape, i.e. plain typing)
function diffBlocks(before: PMNode, after: PMNode) {
  const a = children(before)
  const b = children(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const pairs = new Map<PMNode, PMNode>()
  // equal-length changed regions (endA === endB) pair up index-by-index
  if (endA === endB) for (let i = start; i < endA; i++) pairs.set(a[i], b[i])
  return { fresh: b.slice(start, endB), removed: a.slice(start, endA), pairs }
}

// the ink of a block: words, structure, formatting — everything except
// comment marks, whose coming and going is review-loop metadata, not
// writing. adjacent text runs with the same marks merge, so a comment
// boundary splitting a text node doesn't read as different ink
const inkMarks = (n: PMNode) =>
  n.marks
    .filter((m) => m.type.name !== 'comment')
    .map((m) => m.type.name + JSON.stringify(m.attrs))
    .join(',')

function inkOf(n: PMNode): string {
  // \u0001-\u0003 as field separators — untypeable, so text can't forge them
  let out = '\u0001' + n.type.name + '\u0002' + JSON.stringify(n.attrs) + '\u0002' + inkMarks(n)
  let run: string | null = null
  n.forEach((child) => {
    if (child.isText) {
      const key = inkMarks(child)
      if (key !== run) {
        out += '\u0003' + key + '\u0002'
        run = key
      }
      out += child.text
    } else {
      out += inkOf(child) // hard breaks, images, nested blocks — all count
      run = null
    }
  })
  return out
}

// same ink = nothing but comment marks distinguishes the blocks. marks are
// sizeless, so a nodeSize mismatch (any ordinary typing) rules it out
// before the fingerprints are ever built
const sameInk = (a: PMNode, b: PMNode) =>
  a === b || (a.nodeSize === b.nodeSize && inkOf(a) === inkOf(b))

const carry = (m: Map<PMNode, number>, pairs: Map<PMNode, PMNode>, keep: Set<PMNode>) => {
  const next = new Map<PMNode, number>()
  for (const [node, t] of m) {
    const now = pairs.get(node) ?? node
    if (keep.has(now)) next.set(now, t)
  }
  return next
}

function markDecos(doc: PMNode, marked: Map<PMNode, number>) {
  if (marked.size === 0) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.forEach((node, offset) => {
    if (marked.has(node))
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'co-written' }))
  })
  return DecorationSet.create(doc, decos)
}

export function coWrittenPlugin() {
  return new Plugin<CoState>({
    key: coWrittenKey,
    state: {
      init: () => ({
        others: 0,
        local: new Map(),
        remote: new Map(),
        marked: new Map(),
        decos: DecorationSet.empty,
      }),
      apply(tr, prev) {
        // the editor tells us who's here via awareness
        const presence = tr.getMeta(coWrittenKey)
        if (presence !== undefined) return { ...prev, others: presence.others }
        if (!tr.docChanged) return prev

        const now = Date.now()
        const meta = tr.getMeta(ySyncPluginKey)

        const { fresh, removed, pairs } = diffBlocks(tr.before, tr.doc)
        const alive = new Set(children(tr.doc))
        const local = carry(prev.local, pairs, alive)
        const remote = carry(prev.remote, pairs, alive)
        const marked = carry(prev.marked, pairs, alive)
        const next = (m: Map<PMNode, number>) => ({
          others: prev.others,
          local,
          remote,
          marked: m,
          decos: markDecos(tr.doc, m),
        })

        // re-renders (initial bind, plugin re-registration) arrive flagged
        // isChangeOrigin like collaborator edits, but carry the binding and
        // rebuild every node — they are nobody's pen. real remote changes
        // carry isUndoRedoOperation instead of binding.
        if (meta?.binding) return next(marked)
        // remote = a collaborator's change arriving through yjs; my own
        // undo/redo also travels through yjs but is still my pen
        const isRemote = !!meta?.isChangeOrigin && !meta?.isUndoRedoOperation

        const mine = isRemote ? remote : local
        const theirs = isRemote ? local : remote
        for (const node of fresh) {
          // a comment placed or a settled thread swept rebuilds a block
          // without writing in it — some removed block carries the same
          // ink. the review loop does this constantly, and it (like a
          // block merely moved) must never read as a second writer: no
          // pen recorded, no collision — but an expired note still fades
          const unwritten = removed.some((r) => sameInk(r, node))
          const t = unwritten ? undefined : theirs.get(node)
          if (t !== undefined && now - t < WINDOW && prev.others > 0) {
            marked.set(node, now) // colliding: place the note, or refresh its clock
          } else {
            const m = marked.get(node)
            // the collision went quiet and this block changed again — fade
            if (m !== undefined && now - m > WINDOW) marked.delete(node)
          }
          // with nobody else connected there is no "their pen" — a remote-
          // flagged change while alone is plumbing, not a person
          if (!unwritten && (!isRemote || prev.others > 0)) mine.set(node, now)
        }

        // let old whispers expire so the maps stay small
        for (const m of [local, remote])
          for (const [node, t] of m) if (now - t > WINDOW) m.delete(node)

        return next(marked)
      },
    },
    props: {
      decorations(state) {
        return coWrittenKey.getState(state)?.decos
      },
    },
  })
}

export const CoWritten = Extension.create({
  name: 'coWritten',
  addProseMirrorPlugins() {
    return [coWrittenPlugin()]
  },
})

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
// Not every rebuild is writing: a block whose ink — everything except
// metadata marks (comment threads, autolinked URLs) — matches a block that
// just left the doc was commented, swept, or merely moved, and must never
// read as a second pen. Its clocks and note follow it instead.
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
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode, Mark } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'
import { COMMENT_MARK } from './comment-mark'

const WINDOW = 30_000

// marks that are metadata rather than writing: comment threads (the review
// loop places and sweeps them constantly), and links (autolink decorates
// URLs in *arriving* collaborator text as a local transaction — a
// machine's pen, not a person's)
const METADATA_MARKS = new Set([COMMENT_MARK, 'link'])

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

const bareMarks = (marks: readonly Mark[]) =>
  marks.filter((m) => !METADATA_MARKS.has(m.type.name))

// the block with its metadata marks removed — what the pens actually wrote.
// memoized per transaction so no node is rebuilt twice
function strip(n: PMNode, memo: Map<PMNode, PMNode>): PMNode {
  const hit = memo.get(n)
  if (hit) return hit
  let out: PMNode
  if (n.isText) {
    out = n.mark(bareMarks(n.marks))
  } else {
    const kids: PMNode[] = []
    n.forEach((c) => kids.push(strip(c, memo)))
    // fromArray re-joins text that was split only at a metadata boundary
    out = n.type.create(n.attrs, Fragment.fromArray(kids), bareMarks(n.marks))
  }
  memo.set(n, out)
  return out
}

// same ink = nothing but metadata marks distinguishes the blocks. marks are
// sizeless, so a nodeSize mismatch (any ordinary typing) rules it out
// before anything is built
const sameInk = (a: PMNode, b: PMNode, memo: Map<PMNode, PMNode>) =>
  a === b || (a.nodeSize === b.nodeSize && strip(a, memo).eq(strip(b, memo)))

// blocks whose node identity changed between docs; `pairs` binds old blocks
// to their successors so clocks and the note can follow, `unwritten` holds
// the fresh blocks whose ink already stood in the doc — nobody's stroke
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
  const fresh = b.slice(start, endB)
  const removed: (PMNode | null)[] = a.slice(start, endA)
  const aligned = removed.length === fresh.length
  const pairs = new Map<PMNode, PMNode>()
  const unwritten = new Set<PMNode>()
  const memo = new Map<PMNode, PMNode>()
  const strays: number[] = []
  // a block whose ink already stood in the region — commented, swept, or
  // merely moved (a reorder keeps the region's shape, so this must run
  // regardless of shape) — binds to its old self, each spent once, so its
  // clocks and note follow it and nobody's pen is recorded
  for (let i = 0; i < fresh.length; i++) {
    const j =
      aligned && removed[i] !== null && sameInk(removed[i]!, fresh[i], memo)
        ? i // the aligned twin is the likely match — try it first
        : removed.findIndex((r) => r !== null && sameInk(r, fresh[i], memo))
    if (j >= 0) {
      pairs.set(removed[j]!, fresh[i])
      removed[j] = null
      unwritten.add(fresh[i])
    } else {
      strays.push(i)
    }
  }
  // what's left of a shape-kept region is plain typing — index-by-index
  if (aligned)
    for (const i of strays) if (removed[i] !== null) pairs.set(removed[i]!, fresh[i])
  return { fresh, pairs, unwritten }
}

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

        const { fresh, pairs, unwritten } = diffBlocks(tr.before, tr.doc)
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
          // a comment placed or swept, a URL auto-linked, a block merely
          // moved — rebuilt, but nobody wrote in it: no pen recorded, no
          // collision. an expired note still fades
          const un = unwritten.has(node)
          const t = un ? undefined : theirs.get(node)
          if (t !== undefined && now - t < WINDOW && prev.others > 0) {
            marked.set(node, now) // colliding: place the note, or refresh its clock
          } else {
            const m = marked.get(node)
            // the collision went quiet and this block changed again — fade
            if (m !== undefined && now - m > WINDOW) marked.delete(node)
          }
          // with nobody else connected there is no "their pen" — a remote-
          // flagged change while alone is plumbing, not a person
          if (!un && (!isRemote || prev.others > 0)) mine.set(node, now)
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

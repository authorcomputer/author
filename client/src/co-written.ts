// "✽ written twice" — a quiet margin note on paragraphs that two pens
// rewrote at the same time. CRDTs merge concurrent edits syntactically but
// nobody reads the result; this at least points at where to look.
//
// Pure decorations, like checkmarks: nothing touches the document or the
// Yjs state, so the note is local, ephemeral, and vanishes on reload. A
// paragraph is "written twice" when a local edit and a remote edit land in
// it within WINDOW of each other; the note fades once the next edit arrives
// after the collision has gone quiet.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'

const WINDOW = 30_000

type CoState = {
  local: DecorationSet // invisible: blocks I touched lately (spec.t)
  remote: DecorationSet // invisible: blocks they touched lately (spec.t)
  marks: DecorationSet // the visible margin notes (spec.t = last collision)
}

export const coWrittenKey = new PluginKey<CoState>('co-written')

// top-level block ranges this transaction touched, in post-tr coordinates
function touchedBlocks(tr: Transaction): [number, number][] {
  const blocks = new Map<number, number>()
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1)
    map.forEach((_fromA, _toA, fromB, toB) => {
      const from = Math.min(rest.map(fromB, -1), tr.doc.content.size)
      const to = Math.min(rest.map(toB, 1), tr.doc.content.size)
      tr.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (parent === tr.doc) blocks.set(pos, pos + node.nodeSize)
        return false
      })
    })
  })
  return [...blocks.entries()]
}

const stamp = (doc: Transaction['doc'], from: number, to: number, cls?: string) =>
  Decoration.node(from, to, cls ? { class: cls } : {}, { t: Date.now() })

export function coWrittenPlugin() {
  return new Plugin<CoState>({
    key: coWrittenKey,
    state: {
      init: () => ({
        local: DecorationSet.empty,
        remote: DecorationSet.empty,
        marks: DecorationSet.empty,
      }),
      apply(tr, prev) {
        let local = prev.local.map(tr.mapping, tr.doc)
        let remote = prev.remote.map(tr.mapping, tr.doc)
        let marks = prev.marks.map(tr.mapping, tr.doc)
        if (!tr.docChanged) return { local, remote, marks }

        const now = Date.now()
        // remote = a collaborator's change arriving through yjs; my own
        // undo/redo also travels through yjs but is still my pen
        const meta = tr.getMeta(ySyncPluginKey)
        const isRemote = !!meta?.isChangeOrigin && !meta?.isUndoRedoOperation

        for (const [from, to] of touchedBlocks(tr)) {
          const theirs = (isRemote ? local : remote)
            .find(from, to)
            .some((d) => now - d.spec.t < WINDOW)
          const mark = marks.find(from, to)

          if (theirs) {
            // colliding: place the note, or refresh its clock
            marks = marks.remove(mark).add(tr.doc, [stamp(tr.doc, from, to, 'co-written')])
          } else if (mark.length && now - mark[0].spec.t > WINDOW) {
            // the collision went quiet and someone wrote here again — fade
            marks = marks.remove(mark)
          }

          const mine = isRemote ? remote : local
          const next = mine.remove(mine.find(from, to)).add(tr.doc, [stamp(tr.doc, from, to)])
          if (isRemote) remote = next
          else local = next
        }

        // let old whispers expire so the sets stay small
        for (const which of ['local', 'remote'] as const) {
          const set = which === 'local' ? local : remote
          const old = set.find().filter((d) => now - d.spec.t > WINDOW)
          if (old.length) {
            if (which === 'local') local = set.remove(old)
            else remote = set.remove(old)
          }
        }
        return { local, remote, marks }
      },
    },
    props: {
      decorations(state) {
        return coWrittenKey.getState(state)?.marks
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

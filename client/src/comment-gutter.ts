// The gutter ledger: each commented paragraph shows what it holds — ☜ for
// notes (the manicule pointing back at the text), ↳ for suggested edits,
// with a count when there's more than one. Clicking it opens the comments
// panel. Widget decorations, so the glyphs can actually count marks —
// CSS :has() could only show one.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const key = new PluginKey<DecorationSet>('comment-gutter')

function label(block: PMNode): string {
  const kinds = new Map<string, string>() // comment id -> kind
  block.descendants((node) => {
    for (const m of node.marks) {
      if (m.type.name === 'comment' && m.attrs.id) kinds.set(m.attrs.id, m.attrs.kind || 'note')
    }
  })
  if (kinds.size === 0) return ''
  const edits = [...kinds.values()].filter((k) => k === 'edit').length
  const notes = kinds.size - edits
  return [
    notes ? `☜${notes > 1 ? notes : ''}` : '',
    edits ? `↳${edits > 1 ? edits : ''}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.forEach((block, offset) => {
    const text = label(block)
    if (!text) return
    decos.push(
      Decoration.widget(
        offset + 1,
        () => {
          const el = document.createElement('span')
          el.className = 'comment-gutter'
          el.textContent = text
          el.title = 'open comments'
          el.onclick = () => window.dispatchEvent(new CustomEvent('author:open-comments'))
          return el
        },
        // same label at the same spot → keep the DOM node
        { side: -1, key: `cg:${offset}:${text}` }
      )
    )
  })
  return DecorationSet.create(doc, decos)
}

export const CommentGutter = Extension.create({
  name: 'commentGutter',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_c, state) => build(state.doc),
          apply: (tr, prev) => (tr.docChanged ? build(tr.doc) : prev),
        },
        props: {
          decorations(state) {
            return key.getState(state)
          },
        },
      }),
    ]
  },
})

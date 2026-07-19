// The gutter ledger: each commented line shows what it holds — ☚ for notes
// (the manicule pointing back at the text), ↳ for suggested edits, with a
// count when there's more than one. Clicking it opens the comments panel.
// Widget decorations, so the glyphs can actually count marks.
//
// Widgets live inside each TEXTBLOCK (a paragraph, a heading, a line of a
// list) rather than at the top level — a span at a container's block level
// would be invalid DOM and would pin the glyph to the top of a whole list
// or blockquote instead of the commented line.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const key = new PluginKey<GutterState>('comment-gutter')

type GutterState = { set: DecorationSet; sig: string }

const makeEl = (text: string, ids: string[]) => () => {
  const el = document.createElement('span')
  el.className = 'comment-gutter'
  // the hand wears its size-up span (see .manicule); the counts stay in line
  el.innerHTML = text.replace('☚', '<span class="manicule">☚</span>')
  el.title = 'open comments'
  el.contentEditable = 'false'
  // the glyph is a button, not text — don't let the editor move the caret
  el.onmousedown = (e) => e.preventDefault()
  el.onclick = (e) => {
    e.preventDefault()
    // name the line's first comment so the panel can light its card up
    window.dispatchEvent(new CustomEvent('author:open-comments', { detail: { id: ids[0] } }))
  }
  return el
}

function build(doc: PMNode): GutterState {
  const decos: Decoration[] = []
  const sigs: string[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true // descend through lists, quotes, …
    const kinds = new Map<string, string>() // comment id -> kind
    node.descendants((child) => {
      for (const m of child.marks) {
        if (m.type.name === 'comment' && m.attrs.id) kinds.set(m.attrs.id, m.attrs.kind || 'note')
      }
      return true
    })
    if (kinds.size === 0) return false
    const edits = [...kinds.values()].filter((k) => k === 'edit').length
    const notes = kinds.size - edits
    const text = [
      notes ? `☚${notes > 1 ? notes : ''}` : '',
      edits ? `↳${edits > 1 ? edits : ''}` : '',
    ]
      .filter(Boolean)
      .join(' ')
    sigs.push(`${pos}:${text}`)
    decos.push(
      Decoration.widget(pos + 1, makeEl(text, [...kinds.keys()]), {
        side: -1,
        // keyed by contents, not position — edits elsewhere in the doc
        // shouldn't recreate the DOM node under the reader's cursor
        key: `cg:${text}:${[...kinds.keys()].sort().join('.')}`,
        // clicks on the glyph are ours, not the editor's
        stopEvent: () => true,
      })
    )
    return false
  })
  return {
    set: decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty,
    sig: sigs.join('|'),
  }
}

export const CommentGutter = Extension.create({
  name: 'commentGutter',
  addProseMirrorPlugins() {
    return [
      new Plugin<GutterState>({
        key,
        state: {
          init: (_c, state) => build(state.doc),
          apply(tr, prev) {
            if (!tr.docChanged) return prev
            const next = build(tr.doc)
            // most keystrokes change nothing here — keep the old set (same
            // positions, same labels) so nothing downstream re-renders
            return next.sig === prev.sig ? prev : next
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.set
          },
        },
      }),
    ]
  },
})

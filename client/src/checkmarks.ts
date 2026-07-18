// Editor's-pen decorations: visual markup over the text (wavy underlines,
// highlights, cross-outs) that never touches the document or the Yjs state —
// pure ProseMirror decorations that follow the text as it's edited.
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type MarkItem = {
  from: number
  to: number
  cls: string
  title?: string
  data?: Record<string, string>
}

const KEYS = {
  checks: new PluginKey('author-checks'),
  pending: new PluginKey('author-pending'),
  // the momentary flash that answers a click in the panel — "here, this one"
  ping: new PluginKey('author-ping'),
} as const

export const Checkmarks = Extension.create({
  name: 'checkmarks',
  addProseMirrorPlugins() {
    return (Object.keys(KEYS) as (keyof typeof KEYS)[]).map(
      (name) =>
        new Plugin({
          key: KEYS[name],
          state: {
            init: () => DecorationSet.empty,
            apply(tr, set) {
              const meta = tr.getMeta(KEYS[name])
              if (meta) {
                const items: MarkItem[] = meta.items || []
                return DecorationSet.create(
                  tr.doc,
                  items.map((i) =>
                    Decoration.inline(i.from, i.to, {
                      class: i.cls,
                      ...(i.title ? { title: i.title } : {}),
                      ...(i.data || {}),
                    })
                  )
                )
              }
              return set.map(tr.mapping, tr.doc)
            },
          },
          props: {
            decorations(state) {
              return KEYS[name].getState(state)
            },
          },
        })
    )
  },
})

export function setMarks(editor: Editor, which: keyof typeof KEYS, items: MarkItem[]) {
  editor.view.dispatch(editor.state.tr.setMeta(KEYS[which], { items }))
}

export function clearMarks(editor: Editor, which: keyof typeof KEYS) {
  editor.view.dispatch(editor.state.tr.setMeta(KEYS[which], {}))
}

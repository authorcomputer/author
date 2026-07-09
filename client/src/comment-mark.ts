import { Mark, mergeAttributes } from '@tiptap/core'

// the one name every plugin that must recognize (or ignore) comment marks
// hangs off — co-written.ts filters by it, so a rename here follows through
export const COMMENT_MARK = 'comment'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (id: string, kind?: 'note' | 'edit') => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: COMMENT_MARK,
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-comment-id': attrs.id } : {}),
      },
      // a note (☞) or a suggested edit (↳) — the gutter tells them apart
      kind: {
        default: 'note',
        parseHTML: (el) => el.getAttribute('data-comment-kind') || 'note',
        renderHTML: (attrs) => (attrs.kind ? { 'data-comment-kind': attrs.kind } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]
  },

  addCommands() {
    return {
      setComment:
        (id: string, kind: 'note' | 'edit' = 'note') =>
        ({ commands }) =>
          commands.setMark(this.name, { id, kind }),
    }
  },

  // editor-scoped so it only fires when the page has focus, and Mod- so it
  // works on every platform (⌥⌘M on mac, ctrl+alt+M elsewhere)
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        window.dispatchEvent(new CustomEvent('author:comment'))
        return true
      },
    }
  },
})

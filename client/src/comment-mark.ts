import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (id: string) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-comment-id': attrs.id } : {}),
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
        (id: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { id }),
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

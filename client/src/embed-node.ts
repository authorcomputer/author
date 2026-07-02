import { Node, mergeAttributes } from '@tiptap/core'

// a block iframe for the handful of providers parseEmbed() recognizes. it is
// an atom (no editable children); the src is only ever set from parseEmbed,
// and the server re-validates it on publish.
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      provider: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-provider'),
        renderHTML: (attrs) => (attrs.provider ? { 'data-provider': attrs.provider } : {}),
      },
    }
  },

  parseHTML() {
    // only our own serialized embeds carry data-provider; a raw pasted
    // <iframe> is not adopted into the doc (paste a provider URL instead)
    return [{ tag: 'iframe[data-provider]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'iframe',
      mergeAttributes(HTMLAttributes, {
        class: 'embed',
        loading: 'lazy',
        frameborder: '0',
        allowfullscreen: 'true',
        allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
      }),
    ]
  },
})

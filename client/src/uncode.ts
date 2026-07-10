// A paste can arrive as one giant code block — copy a report out of a chat
// window or a terminal and the clipboard's HTML says <pre>, so the whole
// page lands in monospace with no door back to prose. This is that door:
// dissolve every code block the selection touches. A block that was really a
// markdown document comes back as the document it was — headings, bold, rules
// — and anything else comes back as paragraphs, one per line, blank lines
// dropped (paragraphs already carry the spacing).
// Returns false when the selection holds no code block, so the caller can
// fall through to the inline code mark instead.
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { looksLikeMarkdown, markdownFragment } from './markdown-paste'

export function uncodeBlocks(state: EditorState, tr: Transaction): boolean {
  const { from, to } = state.selection
  const blocks: { pos: number; node: PMNode }[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'codeBlock') {
      blocks.push({ pos, node })
      return false
    }
    return true
  })
  if (!blocks.length) return false
  const paragraph = state.schema.nodes.paragraph
  // walk bottom-up so earlier replacements don't shift later positions
  for (const { pos, node } of blocks.reverse()) {
    const text = node.textContent
    if (looksLikeMarkdown(text)) {
      const content = markdownFragment(state.schema, text)
      if (content.childCount) {
        tr.replaceWith(pos, pos + node.nodeSize, content)
        continue
      }
    }
    const paras = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => paragraph.create(null, state.schema.text(line)))
    tr.replaceWith(pos, pos + node.nodeSize, paras.length ? paras : [paragraph.create()])
  }
  return true
}

import type { Node as PmNode } from '@tiptap/pm/model'

// range-hunting works on the document alone — anything carrying a state
// with a doc will do, so tests can pass a bare doc without a live editor
type HasDoc = { state: { doc: PmNode } }

export function findRange(
  editor: HasDoc,
  excerpt: string
): { from: number; to: number } | null {
  const needles = [excerpt, excerpt.slice(0, 24), excerpt.slice(0, 12)].filter(
    (n) => n.trim().length >= 4
  )
  for (const needle of needles) {
    let found: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isText || !node.text) return
      const idx = node.text.indexOf(needle)
      if (idx >= 0) found = { from: pos + idx, to: pos + idx + needle.length }
    })
    if (found) return found
  }
  return null
}

// a prefix match would replace only part of the passage and leave the
// rest duplicated — anything that rewrites text may only trust a
// full-length match; the prefix fallback is for pointing, never for ink
export function findWholeRange(
  editor: HasDoc,
  excerpt: string
): { from: number; to: number } | null {
  const r = findRange(editor, excerpt)
  return r && r.to - r.from === excerpt.length ? r : null
}

// where a comment's passage lives now: the full span of its mark if it
// survives (bold or a link inside the passage splits it across text nodes —
// take first start to last end), else the quote hunted down whole. a
// cut-and-pasted fragment carries its mark along, so a span is only
// trusted while nothing else has drifted in between its pieces
export function commentRange(editor: HasDoc, c: { id: string; quote: string }) {
  const doc = editor.state.doc
  let from = -1
  let to = -1
  let torn = false
  doc.descendants((node, pos) => {
    if (node.marks.some((mk) => mk.type.name === 'comment' && mk.attrs.id === c.id)) {
      // no block separator: a bare paragraph break between the pieces is
      // structure, not content — but '￼' makes images and embeds count
      if (to >= 0 && doc.textBetween(to, pos, '', '￼')) torn = true
      if (from < 0) from = pos
      to = pos + node.nodeSize
    }
  })
  if (from >= 0 && !torn) return { from, to }
  return findWholeRange(editor, c.quote)
}

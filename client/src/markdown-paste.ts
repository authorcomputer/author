// A report copied out of a chat window arrives as its own syntax: '# Title'
// on a line, '**claim**' in the middle of one. The clipboard calls it text,
// sometimes wraps it in <pre>, and either way the page ends up wearing the
// punctuation instead of the shape. Read it as what it plainly is.
import { DOMParser as PMDOMParser, Fragment, Schema, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { renderMarkdown } from './markdown'

// each of these is a thing prose almost never does by accident, and code does
// only one of at a time — a python '# comment' is a heading and nothing else.
// two independent signals is the line: enough for a real document, too much
// for a stray hash
const SIGNALS = [
  /^#{1,6}[ \t]+\S/m, // # heading
  /\*\*[^*\n]+\*\*/, // **bold**
  /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m, // --- rule
  /^[ \t]*[-*+][ \t]+\S/m, // - list (the space is what a -flag lacks)
  /^[ \t]*\d+\.[ \t]+\S/m, // 1. list
  /^[ \t]*>[ \t]+\S/m, // > quote
  /^\|.*\|[ \t]*$/m, // | table |
  /\[[^\]\n]+\]\([^)\s]+\)/, // [link](url)
  /^[ \t]*```/m, // fenced code
]

// a header row over a delimiter row is a table and can be nothing else —
// no prose and no code stumbles into that shape by accident
const TABLE = /^\|.*\|[ \t]*\n[ \t]*\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/m

export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 3) return false
  if (TABLE.test(text)) return true
  let hits = 0
  for (const re of SIGNALS) {
    if (re.test(text) && ++hits >= 2) return true
  }
  return false
}

// markdown → the nodes this schema knows. renderMarkdown already scrubs the
// html down to the tags the editor itself produces, so nothing arrives here
// that the page couldn't have made on its own
export function markdownFragment(schema: Schema, md: string): Fragment {
  const html = renderMarkdown(md)
  const dom = new window.DOMParser().parseFromString(html, 'text/html')
  return PMDOMParser.fromSchema(schema).parse(dom.body).content
}

// returns false when the text isn't markdown, so the caller can let the
// ordinary paste happen
export function pasteMarkdown(view: EditorView, text: string): boolean {
  if (!looksLikeMarkdown(text)) return false
  const content = markdownFragment(view.state.schema, text)
  if (!content.childCount) return false
  view.dispatch(view.state.tr.replaceSelection(new Slice(content, 0, 0)).scrollIntoView())
  return true
}

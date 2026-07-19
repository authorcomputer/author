// the comment glyph: a speech bubble, drawn rather than typed. every font
// renders its dingbats at a different weight — an inline path in
// currentColor is the same little bubble on every platform. drawn in
// strokes, not fill, so it sits in the line-glyph family (✎ ↳ ✉ ✓) rather
// than shouting over it; the tail points back at the words like the
// gutter's old manicule did.
export const BUBBLE_SVG =
  '<svg class="bubble" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3.5 1.5h9a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-5l-4 3.6v-3.6a2.5 2.5 0 0 1-2.5-2.5v-4a2.5 2.5 0 0 1 2.5-2.5z"/>' +
  '</svg>'

export default function Bubble() {
  return <span dangerouslySetInnerHTML={{ __html: BUBBLE_SVG }} />
}

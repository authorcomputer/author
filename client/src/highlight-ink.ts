import { highlight, highlightSelection } from '@highlighters/core'
import type { HighlightOptions, MarkHandle } from '@highlighters/core'
import type { Editor } from '@tiptap/react'

// realistic highlighter strokes (highlighte.rs) over text the app already
// marks. two layers, both pure overlay: neither touches the document, the
// Yjs state, or what a click lands on

const dark = () => document.documentElement.dataset.mode === 'dark'

// the app's own tones, not the library's palettes. light mode multiplies the
// cream gold over the paper and lands where the old flat #fbf0d9 band sat;
// dark mode screens burnt orange over dark paper — solved so peak ink lands
// on the old #3a2f15 wash (the gutter gold screened too yellow-green there)
// update() merges over the live config, so both branches must name every
// field the other one sets — an omitted key would survive the lamp flip
const commentOpts = (editable: boolean): HighlightOptions => ({
  ...(dark()
    ? { color: '#7a5807', vivid: 'screen' as const, opacity: 0.35 }
    : { color: '#f7e6c3', vivid: false as const, opacity: 1 }),
  // an inline span, not a block — clamp to its words, not the whole line
  snap: 'word',
  // a touch straighter than the library's 35° chisel
  tip: { angle: 28 },
  // the writing view redraws on every keystroke; the flat css band keeps
  // that cheap. the read-only review view can afford the full svg ink
  renderer: editable ? 'css' : 'auto',
})

// paints every comment-mark span with highlighter ink. prosemirror owns the
// spans and recreates them freely, so this diffs the live dom after each
// transaction: new spans get ink, orphaned handles are dropped
export function attachCommentInk(editor: Editor): () => void {
  const marks = new Map<Element, MarkHandle>()
  const spots = new Map<Element, string>()
  const kids = new Map<Element, Node[]>()
  let raf = 0

  // the ink handle holds live DOM ranges over the span's text nodes from
  // mount time. typing mutates a text node in place and the ranges hold,
  // but a paragraph split/join swaps the nodes out and the ranges collapse
  // to nothing — same element, dead anchors. node identity is the tell
  const textNodesOf = (el: Element): Node[] => {
    const out: Node[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) out.push(n)
    return out
  }
  const sameNodes = (a: Node[] | undefined, b: Node[]) =>
    !!a && a.length === b.length && a.every((n, i) => n === b[i])

  const sync = () => {
    raf = 0
    if (editor.isDestroyed) return
    // the overlay must scroll with the text, so it mounts inside .ed-scroll
    const host = editor.view.dom.closest<HTMLElement>('.ed-scroll')
    // every handle shares one overlay container, and removing any handle
    // tears the container down if it looks empty — which it always does,
    // because the bands live in blend-layer siblings. the survivors then
    // measure against a detached node and their ink vanishes. a keeper
    // child makes the container never look empty, so it never comes down
    const shared = host?.querySelector(':scope > [data-highlighters-overlay]')
    if (shared && !shared.firstChild) shared.appendChild(document.createElement('i'))
    // positions are read in the coordinate system the bands actually live
    // in — the overlay container. it scrolls with the text (no false moves
    // on scroll) and it catches the editor block itself shifting inside the
    // scroller, which the editor's own rect can't see. before the first
    // handle exists there's no container yet; the editor body stands in
    const origin = (shared ?? editor.view.dom).getBoundingClientRect()
    const seen = new Set<Element>()
    for (const el of editor.view.dom.querySelectorAll('span.comment-mark')) {
      seen.add(el)
      const r = el.getBoundingClientRect()
      const spot = `${r.top - origin.top},${r.left - origin.left},${r.width},${r.height}`
      const nodes = textNodesOf(el)
      const handle = marks.get(el)
      if (!handle) {
        marks.set(el, highlight(el, commentOpts(editor.isEditable), host))
      } else if (!sameNodes(kids.get(el), nodes)) {
        // swapped text nodes: the old handle's anchors are dead — only a
        // fresh mount captures ranges over the nodes that exist now
        handle.remove()
        marks.set(el, highlight(el, commentOpts(editor.isEditable), host))
      } else if (spots.get(el) !== spot) {
        // an upstream edit slid this span without resizing anything, so the
        // library's reflow observer stays quiet and the ink is stranded at
        // its draw-time coordinates. geometry is only re-measured when snap
        // changes — flush the cache through it, then restore. same frame,
        // so only the corrected stroke ever paints, and retarget keeps the
        // draw-on animation from replaying
        handle.update({ snap: 'none' })
        handle.update({ snap: 'word' })
      }
      spots.set(el, spot)
      kids.set(el, nodes)
    }
    for (const [el, handle] of marks) {
      if (!seen.has(el)) {
        handle.remove()
        marks.delete(el)
        spots.delete(el)
        kids.delete(el)
      }
    }
  }
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(sync)
  }

  editor.on('transaction', queue)
  queue()

  // not every shift is an edit: the ui above the editor growing (a header
  // image landing) moves the text without a transaction. the page resizing
  // is the tell for those — sync is cheap when nothing actually moved
  const ro = new ResizeObserver(queue)
  const page = editor.view.dom.closest('.ed-page')
  if (page) ro.observe(page)
  ro.observe(editor.view.dom)

  // the lamp flips data-mode without a rerender — recolor the ink in place
  const lamp = new MutationObserver(() => {
    for (const handle of marks.values()) handle.update(commentOpts(editor.isEditable))
  })
  lamp.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })

  return () => {
    editor.off('transaction', queue)
    if (raf) cancelAnimationFrame(raf)
    ro.disconnect()
    lamp.disconnect()
    for (const handle of marks.values()) handle.remove()
    marks.clear()
  }
}

// the ::selection peach, poured as ink. it draws over the native selection
// wash in the same hue, so the drag deepens the way a second swipe would.
// dark screens burnt orange, solved to land on the old #4a3421 wash
const selectionOpts = (): HighlightOptions => ({
  ...(dark()
    ? { color: '#b56a32', vivid: 'screen' as const, opacity: 0.35 }
    : { color: '#f3d9c9', vivid: false as const, opacity: 1 }),
  // wetter ink when the drag slows down — live selection only
  speed: { enabled: true },
  // same eased chisel slant as the comment ink
  tip: { angle: 28 },
})

// wet ink under the cursor as a reader drags a selection — for the pages
// that are read, not written: landing and updates. touch devices keep the
// native selection ui (the library hands back an inert handle there)
export function attachSelectionInk(): () => void {
  const live = highlightSelection(selectionOpts())
  // the ink replaces the flat ::selection wash — painting both doubles the
  // band. ink-live suppresses the wash, but only for fine pointers: on
  // touch the library defers to native selection, which must stay visible
  if (!window.matchMedia('(pointer: coarse)').matches) {
    document.documentElement.classList.add('ink-live')
  }
  const lamp = new MutationObserver(() => live.update(selectionOpts()))
  lamp.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
  return () => {
    lamp.disconnect()
    document.documentElement.classList.remove('ink-live')
    live.remove()
  }
}

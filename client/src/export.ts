// what a page becomes when it leaves the house — markdown, html, or bare
// text a reader can carry anywhere. markdown rides prosemirror-markdown
// (already in the sleigh via @tiptap/pm) so escaping, fence-lengthening,
// and list indentation are the library's problem, and an unmapped node
// fails loudly instead of vanishing from the export. review metadata
// (comment marks) is ink about the ink and stays home.
import type { Node as PMNode } from '@tiptap/pm/model'
import { MarkdownSerializer, defaultMarkdownSerializer } from '@tiptap/pm/markdown'

const d = defaultMarkdownSerializer

const serializer = new MarkdownSerializer(
  {
    paragraph: d.nodes.paragraph,
    heading: d.nodes.heading,
    blockquote: d.nodes.blockquote,
    horizontalRule: d.nodes.horizontal_rule,
    hardBreak: d.nodes.hard_break,
    listItem: d.nodes.list_item,
    text: d.nodes.text,
    bulletList(state, node) {
      state.renderList(node, '  ', () => '- ')
    },
    orderedList(state, node) {
      // ?? not ||: an author-pasted <ol start="0"> keeps its zero
      const start = Number(node.attrs.start ?? 1)
      const maxW = String(start + node.childCount - 1).length
      state.renderList(node, ' '.repeat(maxW + 2), (i) => {
        const n = String(start + i)
        return ' '.repeat(maxW - n.length) + n + '. '
      })
    },
    codeBlock(state, node) {
      // tiptap says `language` where prosemirror says `params`
      const ticks = node.textContent.match(/`{3,}/gm)
      const fence = ticks ? ticks.sort().slice(-1)[0] + '`' : '```'
      state.write(fence + ((node.attrs.language as string) || '') + '\n')
      state.text(node.textContent, false)
      state.ensureNewLine()
      state.write(fence)
      state.closeBlock(node)
    },
    image(state, node) {
      const origin = (state.options as { origin?: string }).origin ?? ''
      state.write(`![${(node.attrs.alt as string) || ''}](${abs((node.attrs.src as string) || '', origin)})`)
      state.closeBlock(node)
    },
    embed(state, node) {
      state.write((node.attrs.src as string) || '')
      state.closeBlock(node)
    },
  },
  {
    bold: d.marks.strong,
    italic: d.marks.em,
    code: d.marks.code,
    link: d.marks.link,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '<u>', close: '</u>', mixable: true },
    comment: { open: '', close: '', mixable: true },
  }
)

function abs(src: string, origin: string): string {
  return src.startsWith('/') ? origin + src : src
}

export function docToMarkdown(doc: PMNode, origin = globalThis.location?.origin ?? ''): string {
  return serializer.serialize(doc, { tightLists: true, origin } as Parameters<
    typeof serializer.serialize
  >[1]) + '\n'
}

/* ---- html fit to leave: strip review ink, absolutize upload srcs ---- */

// works on the parsed DOM, not the string — a code sample that happens to
// contain the text src="/files/…" is prose, not an attribute, and stays put
export function exportableHtml(rawHtml: string, origin = globalThis.location?.origin ?? ''): string {
  const dom = new DOMParser().parseFromString(rawHtml, 'text/html')
  dom.querySelectorAll('span[data-comment-id], span.comment-mark').forEach((el) => {
    el.replaceWith(...el.childNodes)
  })
  dom.querySelectorAll('img[src^="/"]').forEach((el) => {
    el.setAttribute('src', origin + el.getAttribute('src'))
  })
  return dom.body.innerHTML
}

/* ---- a standalone page the html download can be opened as ---- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function standaloneHtml(
  title: string,
  bodyHtml: string,
  origin = globalThis.location?.origin ?? ''
): string {
  const body = exportableHtml(bodyHtml, origin)
  const esc = escapeHtml(title)
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc}</title>
<style>
  body { max-width: 640px; margin: 40px auto; padding: 0 24px;
         font-family: Georgia, 'Times New Roman', serif; font-size: 17px;
         line-height: 1.6; color: #1c1a17; background: #fdfcf9; }
  img { max-width: 100%; }
  blockquote { border-left: 2px solid #c9c4ba; margin-left: 0; padding-left: 16px; }
  pre { background: #f4f1ea; padding: 12px; overflow-x: auto; }
  code { background: #f4f1ea; padding: 1px 3px; }
  iframe.embed { width: 100%; aspect-ratio: 16 / 9; border: 0; }
</style>
<body>
<h1>${esc}</h1>
${body}
</body>
</html>
`
}

/* ---- handing the file over ---- */

export function fileStem(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled'
  )
}

export function download(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // let the download dereference the blob before the URL dies (old Firefox
  // aborted on same-tick revoke)
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
